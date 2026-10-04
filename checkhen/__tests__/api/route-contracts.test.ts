import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getServerSession } from 'next-auth';
import { createMocks } from 'node-mocks-http';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    class: { findFirst: jest.fn() },
    rosterEntry: { findUnique: jest.fn() },
  },
}));

type Route = { name: string; handler: (req: any, res: any) => Promise<unknown> | unknown };
const apiRoot = join(process.cwd(), 'pages', 'api');
const routes: Route[] = ['', 'student', 'admin', 'auth'].flatMap((folder) => {
  const directory = join(apiRoot, folder);
  return readdirSync(directory)
    .filter((file) => file.endsWith('.ts') && file !== '[...nextauth].ts')
    .map((file) => ({
      name: folder ? `${folder}/${file}` : file,
      handler: jest.requireActual(join(directory, file)).default,
    }));
});
const instructorRoutes = routes.filter((route) => route.name.startsWith('admin/'));
const instructorMethod = (name: string) =>
  [
    'ack-hand-raise',
    'end-class-early',
    'hide-chat',
    'mute-student',
    'projection-ticket',
    'rate-hand-raise',
    'reset-pace-signals',
    'start-new-class',
  ].some((action) => name === `admin/${action}.ts`)
    ? 'POST'
    : 'GET';

async function invoke(route: Route, method: 'GET' | 'POST' | 'OPTIONS') {
  const { req, res } = createMocks({
    method,
    query: { courseId: 'course-1', classId: 'session-1' },
    body: { courseId: 'course-1', classId: 'session-1' },
  });
  await route.handler(req, res);
  return res._getStatusCode();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_EMAILS = 'teacher';
  process.env.NEXT_PUBLIC_EMAIL_DOMAIN = 'bu.edu';
  (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'teacher@bu.edu' } });
  (prisma.course.findUnique as jest.Mock).mockResolvedValue({ id: 'course-1' });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'user-1',
    email: 'teacher@bu.edu',
  });
  (prisma.class.findFirst as jest.Mock).mockResolvedValue({
    id: 'session-1',
    courseId: 'course-1',
  });
});

describe('HTTP route contracts', () => {
  it.each(routes)('$name rejects an unsupported method', async (route) => {
    expect(await invoke(route, 'OPTIONS')).toBe(405);
  });

  it.each(instructorRoutes)('$name rejects a non-instructor', async (route) => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'student@bu.edu' } });
    expect(await invoke(route, instructorMethod(route.name))).toBe(403);
  });
});
