import type { NextApiRequest, NextApiResponse } from 'next';
import { demoDatabaseProblem, isDemo } from './demo';
import { prisma } from './prisma';

/**
 * A public demo makes every visitor the instructor, so demo writes are rate limited
 * per client and overall, and stop when the database reaches a size cap.
 */
const LIMITS = {
  write: { perClient: 60, overall: 600, windowMs: 60_000 },
  reset: { perClient: 3, overall: 12, windowMs: 60 * 60_000 },
} as const;
type Bucket = keyof typeof LIMITS;

const DEFAULT_MAX_DATABASE_MB = 512;
const SIZE_CHECK_MS = 30_000;

const windows = new Map<string, { start: number; count: number }>();
let sizeCheck: { at: number; bytes: number } | null = null;

/** Tests only: forget every counter and the cached database size. */
export function resetDemoLimits() {
  windows.clear();
  sizeCheck = null;
}

/** Cloudflare sets cf-connecting-ip; a direct loopback request has only its socket. */
function clientKey(req: NextApiRequest): string {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();
  };
  return header('cf-connecting-ip') || header('x-forwarded-for') || req.socket?.remoteAddress || 'unknown';
}

function take(key: string, max: number, windowMs: number, now: number): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

function allowed(req: NextApiRequest, bucket: Bucket): boolean {
  const { perClient, overall, windowMs } = LIMITS[bucket];
  const now = Date.now();
  if (windows.size > 10_000) {
    windows.forEach((value, key) => {
      if (now - value.start >= windowMs) windows.delete(key);
    });
  }
  // Count both, so a client over its own limit still uses up the shared one.
  const client = take(`${bucket}:client:${clientKey(req)}`, perClient, windowMs, now);
  const all = take(`${bucket}:all`, overall, windowMs, now);
  return client && all;
}

async function databaseFull(): Promise<boolean> {
  const maxMb = Number(process.env.DEMO_MAX_DATABASE_MB) || DEFAULT_MAX_DATABASE_MB;
  const now = Date.now();
  if (!sizeCheck || now - sizeCheck.at >= SIZE_CHECK_MS) {
    const [row] = await prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_database_size(current_database()) AS bytes`;
    sizeCheck = { at: now, bytes: Number(row.bytes) };
  }
  return sizeCheck.bytes >= maxMb * 1024 * 1024;
}

/**
 * Checks every demo request before a route runs. Outside demo mode it allows
 * everything. Returns false after it has sent the refusal.
 */
export type GateOptions = { bucket?: Bucket; pastSizeCap?: boolean };

export async function demoGate(
  req: NextApiRequest,
  res: NextApiResponse,
  { bucket = 'write', pastSizeCap = false }: GateOptions = {}
): Promise<boolean> {
  if (!isDemo()) {
    return true;
  }
  const problem = await demoDatabaseProblem(prisma);
  if (problem) {
    res.status(503).json({ message: problem });
    return false;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return true;
  }
  if (!allowed(req, bucket)) {
    res.setHeader('Retry-After', String(Math.ceil(LIMITS[bucket].windowMs / 1000)));
    res.status(429).json({ message: 'The demo is busy. Wait a minute, then try again.' });
    return false;
  }
  // A reset adds one small course and has its own tight limit, so it runs at the cap.
  if (!pastSizeCap && (await databaseFull())) {
    res.status(507).json({ message: 'The demo has reached its storage limit and takes no new changes.' });
    return false;
  }
  return true;
}
