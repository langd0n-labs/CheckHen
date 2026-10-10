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

type Counter = { start: number; count: number; windowMs: number };
// Per-client counters, bounded: when full, the oldest is evicted, never a new client
// refused. The shared counters live apart, so no client can push them out.
const windows = new Map<string, Counter>();
const shared = new Map<Bucket, Counter>();
let sizeCheck: { at: number; bytes: number } | null = null;

/** Tests only: how many per-client counters are held. */
export function demoLimitKeys(): number {
  return windows.size;
}

/** Tests only: forget every counter and the cached database size. */
export function resetDemoLimits() {
  windows.clear();
  shared.clear();
  sizeCheck = null;
  databaseCheck = null;
}

/** The first `groups` groups of an IPv6 address, as a prefix. */
function ipv6Prefix(address: string, groups: number): string {
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const all = address.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${all
    .slice(0, groups)
    .map((group) => parseInt(group || '0', 16).toString(16))
    .join(':')}::/${groups * 16}`;
}

/**
 * Cloudflare sets cf-connecting-ip; a direct loopback request has only its socket.
 * The origin binds 127.0.0.1, so only the tunnel and local requests reach it. One
 * client usually holds an IPv6 /64; for resets, a whole /48 counts as one client.
 */
export function clientKey(req: NextApiRequest, prefixGroups = 4): string {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();
  };
  const address =
    header('cf-connecting-ip') ||
    header('x-forwarded-for') ||
    req.socket?.remoteAddress ||
    'unknown';
  return isIPv6(address) && !address.includes('.') ? ipv6Prefix(address, prefixGroups) : address;
}

function count(counter: Counter | undefined, max: number, windowMs: number, now: number) {
  if (!counter || now - counter.start >= windowMs) {
    return { counter: { start: now, count: 1, windowMs }, ok: true };
  }
  counter.count += 1;
  return { counter, ok: counter.count <= max };
}

function allowed(req: NextApiRequest, bucket: Bucket): boolean {
  const { perClient, overall, windowMs } = LIMITS[bucket];
  const now = Date.now();
  const key = `${bucket}:${clientKey(req, bucket === 'reset' ? 3 : 4)}`;
  const own = count(windows.get(key), perClient, windowMs, now);
  // Re-insert, so the map's order is oldest use first.
  windows.delete(key);
  if (windows.size >= MAX_KEYS) {
    windows.forEach((value, candidate) => {
      if (now - value.start >= value.windowMs) windows.delete(candidate);
    });
    while (windows.size >= MAX_KEYS) {
      windows.delete(windows.keys().next().value!);
    }
  }
  windows.set(key, own.counter);
  // A client over its own limit is refused before it reaches the shared limit, so one
  // client cannot use up everyone's share.
  if (!own.ok) {
    return false;
  }
  const all = count(shared.get(bucket), overall, windowMs, now);
  shared.set(bucket, all.counter);
  return all.ok;
}

export async function databaseFull(): Promise<boolean> {
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
