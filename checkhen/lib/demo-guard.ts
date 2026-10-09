import type { NextApiRequest, NextApiResponse } from 'next';
import { isIPv6 } from 'node:net';
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
// A flood of reads or sign-ins must not become a flood of count queries.
const DATABASE_CHECK_MS = 5_000;
let databaseCheck: { at: number; problem: string | null } | null = null;

/** The demo-only database check, cached for a few seconds. */
export async function demoDatabaseRefusal(): Promise<string | null> {
  const now = Date.now();
  if (!databaseCheck || now - databaseCheck.at >= DATABASE_CHECK_MS) {
    databaseCheck = { at: now, problem: await demoDatabaseProblem(prisma) };
  }
  return databaseCheck.problem;
}
const SIZE_CHECK_MS = 30_000;

// Counters for at most this many clients; under an address flood, new clients wait.
const MAX_KEYS = 10_000;

const windows = new Map<string, { start: number; count: number; windowMs: number }>();
let sizeCheck: { at: number; bytes: number } | null = null;

/** Tests only: how many counters are held. */
export function demoLimitKeys(): number {
  return windows.size;
}

/** Tests only: forget every counter and the cached database size. */
export function resetDemoLimits() {
  windows.clear();
  sizeCheck = null;
  databaseCheck = null;
}

/** The first four groups of an IPv6 address: one client usually holds a whole /64. */
function ipv6Prefix64(address: string): string {
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
}

/**
 * Cloudflare sets cf-connecting-ip; a direct loopback request has only its socket.
 * The origin binds 127.0.0.1, so only the tunnel and local requests reach it.
 */
export function clientKey(req: NextApiRequest): string {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();
  };
  const address =
    header('cf-connecting-ip') ||
    header('x-forwarded-for') ||
    req.socket?.remoteAddress ||
    'unknown';
  return isIPv6(address) && !address.includes('.') ? ipv6Prefix64(address) : address;
}

function take(key: string, max: number, windowMs: number, now: number): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    if (!current && windows.size >= MAX_KEYS) {
      return false;
    }
    windows.set(key, { start: now, count: 1, windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

function allowed(req: NextApiRequest, bucket: Bucket): boolean {
  const { perClient, overall, windowMs } = LIMITS[bucket];
  const now = Date.now();
  if (windows.size >= MAX_KEYS) {
    // Each counter expires on its own window: a write must not clear the hourly
    // reset counters.
    windows.forEach((value, key) => {
      if (now - value.start >= value.windowMs) windows.delete(key);
    });
  }
  // A client over its own limit is refused before it reaches the shared limit, so one
  // client cannot use up everyone's share.
  if (!take(`${bucket}:client:${clientKey(req)}`, perClient, windowMs, now)) {
    return false;
  }
  return take(`${bucket}:all`, overall, windowMs, now);
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
  const problem = await demoDatabaseRefusal();
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
    res
      .status(507)
      .json({ message: 'The demo has reached its storage limit and takes no new changes.' });
    return false;
  }
  return true;
}
