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
  if (isIP(address) !== 4) {
    throw new PortalBindingError('AP client address missing', 403);
  }
  return address;
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
