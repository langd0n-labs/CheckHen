import type { NextApiRequest } from 'next';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

type Scope = { courseId: string; classId: string };
type Identity = { id: string };
export type DeviceBinding = { ip: string; mac: string };

export class PortalBindingError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function clientAddress(req: NextApiRequest): string {
  // The app port stays on loopback. The local TLS proxy overwrites this header.
  const header = req.headers['x-real-ip'];
  const address = typeof header === 'string' ? header : '';
  const version = isIP(address);
  if (!version || !inApSubnet(address, version)) {
    throw new PortalBindingError('AP client address missing', 403);
  }
  return address;
}

function ipv6Groups(address: string): number[] | null {
  const parts = address.toLowerCase().split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups = [...left, ...Array(parts.length === 2 ? 8 - left.length - right.length : 0).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

function inApSubnet(address: string, version: number): boolean {
  if (version === 4) {
    const [network, bitsText] = (process.env.AP_SUBNET || '172.16.77.0/24').split('/');
    const bits = Number(bitsText);
    if (isIP(network) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const number = (ip: string) => ip.split('.').reduce((value, part) => (value << 8) | Number(part), 0) >>> 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (number(address) & mask) === (number(network) & mask);
  }
  const [network, bitsText] = (process.env.AP_IPV6_PREFIX || 'fd9b:2f69:8c44::/64').split('/');
  const bits = Number(bitsText);
  const value = ipv6Groups(address);
  const prefix = ipv6Groups(network);
  if (value === null || prefix === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const full = Math.floor(bits / 16);
  if (value.slice(0, full).some((group, index) => group !== prefix[index])) return false;
  const remainder = bits % 16;
  const mask = remainder ? (0xffff << (16 - remainder)) & 0xffff : 0;
  return !remainder || (value[full] & mask) === (prefix[full] & mask);
}

async function callAgent(
  action: 'bind' | 'revoke' | 'revoke-student' | 'revoke-session',
  body: Record<string, unknown>
): Promise<DeviceBinding | null> {
  const url = process.env.PORTAL_AGENT_URL;
  const secret = process.env.PORTAL_CONTROL_SECRET;
  if (!url || !secret) {
    throw new PortalBindingError('Portal agent is not configured', 503);
  }
  const payload = JSON.stringify({ ...body, timestamp: Date.now() });
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CheckHen-Signature': signature },
      body: payload,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new PortalBindingError('Portal agent unavailable', 503);
  }
  if (!response.ok) {
    throw new PortalBindingError(
      response.status === 403 ? 'AP lease not found' : 'Portal authorization failed',
      response.status === 403 ? 403 : 503
    );
  }
  if (action === 'revoke-student' || action === 'revoke-session') return null;
  const result = await response.json();
  if (typeof result?.ip !== 'string' || typeof result?.mac !== 'string') {
    throw new PortalBindingError('Invalid portal agent response', 503);
  }
  return { ip: result.ip, mac: result.mac };
}

export async function bindDevice(
  req: NextApiRequest,
  scope: Scope,
  user: Identity
): Promise<DeviceBinding> {
  if (!process.env.PORTAL_AGENT_URL || !process.env.PORTAL_CONTROL_SECRET) {
    throw new PortalBindingError('Portal agent is not configured', 503);
  }
  return (await callAgent('bind', { ...scope, userId: user.id, ip: clientAddress(req) }))!;
}

export async function revokeDevice(
  binding: DeviceBinding | null,
  scope: Scope,
  user: Identity
): Promise<void> {
  if (!binding) {
    return;
  }
  await callAgent('revoke', { ...scope, userId: user.id, ip: binding.ip });
}

export async function revokeCurrentDevice(req: NextApiRequest, scope: Scope, user: Identity): Promise<void> {
  await callAgent('revoke', { ...scope, userId: user.id, ip: clientAddress(req) });
}

export async function revokeStudentDevices(scope: Scope, user: Identity): Promise<void> {
  await callAgent('revoke-student', { ...scope, userId: user.id });
}

export async function revokeSessionDevices(scope: Scope): Promise<void> {
  await callAgent('revoke-session', scope);
}
