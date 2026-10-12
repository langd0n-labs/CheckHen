// Mock next-auth and the [...nextauth] module before importing the handler
jest.mock('next-auth', () => {
  const mockGetServerSession = jest.fn();
  return {
    __esModule: true,
    default: () => jest.fn(), // NextAuth factory — returns a handler
    getServerSession: mockGetServerSession,
  };
});

jest.mock('@/pages/api/auth/[...nextauth]', () => ({
  authOptions: {},
}));

import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/auth/is-admin';
import * as nextAuth from 'next-auth';

const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    ADMIN_EMAILS: 'prof',
    NEXT_PUBLIC_EMAIL_DOMAIN: 'bu.edu',
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.clearAllMocks();
});

describe('GET /api/auth/is-admin', () => {
  it('returns isAdmin: false when not authenticated', async () => {
    (nextAuth.getServerSession as jest.Mock).mockResolvedValue(null);
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ isAdmin: false });
  });

  it('returns isAdmin: true for an admin email', async () => {
    (nextAuth.getServerSession as jest.Mock).mockResolvedValue({
      user: { email: 'prof@bu.edu' },
    });
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ isAdmin: true });
  });

  it('returns isAdmin: false for a non-admin email', async () => {
    (nextAuth.getServerSession as jest.Mock).mockResolvedValue({
      user: { email: 'student@bu.edu' },
    });
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ isAdmin: false });
  });

  it('returns 405 for non-GET requests', async () => {
    (nextAuth.getServerSession as jest.Mock).mockResolvedValue(null);
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });
});
