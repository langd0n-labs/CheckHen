/** @jest-environment node */
beforeEach(() => { process.env.NEXTAUTH_URL = 'https://checkhen.test'; });
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getServerSession } from 'next-auth';
import { createMocks } from 'node-mocks-http';
import { prisma } from '@/lib/prisma';
import { instructsAnyCourse } from '@/lib/staff';
import courseStaffRoute from '@/pages/api/admin/course-staff';
import profileRoute from '@/pages/api/admin/get-student-profile';
import coursesRoute from '@/pages/api/courses';
import sessionsRoute from '@/pages/api/sessions';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const POST_ROUTES = [
  'ack-hand-raise',
  'end-class-early',
  'hide-chat',
  'unhide-chat',
  'mute-student',
  'projection-ticket',
  'rate-hand-raise',
  'reset-pace-signals',
  'revoke-projection',
  'start-new-class',
];
const adminDir = join(process.cwd(), 'pages', 'api', 'admin');
const adminRoutes = readdirSync(adminDir)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({
    name: file.replace(/\.ts$/, ''),
    handler: jest.requireActual(join(adminDir, file)).default as (
      req: any,
      res: any
    ) => Promise<unknown>,
  }));

const integration = process.env.CHECKHEN_INTEGRATION === '1' ? describe : describe.skip;
integration('course-scoped staff', () => {
  const suffix = randomUUID();
  const email = (name: string) => `${name}-${suffix}@bu.edu`;
  let courseA: { id: string };
  let courseB: { id: string };
  let classA: { id: string };
  let classB: { id: string };
  const as = (who: string) =>
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: email(who) } });
  const call = async (
    handler: (req: any, res: any) => Promise<unknown>,
    method: string,
    query: Record<string, string>,
    body: Record<string, unknown> = {}
  ) => {
    const { req, res } = createMocks({ headers: { origin: 'https://checkhen.test', 'content-type': 'application/json' }, method: method as any, query, body: { ...query, ...body } });
    await handler(req, res);
    return res;
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_EMAIL_DOMAIN = 'bu.edu';
    process.env.ADMIN_EMAILS = `owner-${suffix}`;
    delete process.env.CHECKHEN_DEMO;
    courseA = await prisma.course.create({ data: { name: `Staff A ${suffix}` } });
    courseB = await prisma.course.create({ data: { name: `Staff B ${suffix}` } });
    classA = await prisma.class.create({ data: { courseId: courseA.id, name: 'A', duration: 60 } });
    classB = await prisma.class.create({ data: { courseId: courseB.id, name: 'B', duration: 60 } });
    const [ta, studentB] = await Promise.all(
      ['ta', 'student-b', 'owner'].map((name) =>
        prisma.user.create({ data: { email: email(name) } })
      )
    );
    await prisma.courseStaff.create({ data: { courseId: courseA.id, userId: ta.id, role: 'ta' } });
    await prisma.rosterEntry.create({ data: { courseId: courseB.id, userId: studentB.id } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses course A staff on every instructor route of course B', async () => {
    as('ta');
    const refused: string[] = [];
    for (const route of adminRoutes) {
      const method = POST_ROUTES.includes(route.name) ? 'POST' : 'GET';
      const res = await call(route.handler, method, { courseId: courseB.id, classId: classB.id });
      if (res._getStatusCode() !== 403) refused.push(`${route.name} ${res._getStatusCode()}`);
    }
    expect(refused).toEqual([]);
  });

  it('lets course A staff use course A', async () => {
    as('ta');
    const scope = { courseId: courseA.id, classId: classA.id };
    for (const name of [
      'fetch-check-ins',
      'fetch-all-chat',
      'course-report',
      'roster',
      'course-staff',
    ]) {
      const route = adminRoutes.find((candidate) => candidate.name === name)!;
      expect([name, (await call(route.handler, 'GET', scope))._getStatusCode()]).toEqual([
        name,
        200,
      ]);
    }
    expect((await call(sessionsRoute, 'GET', { courseId: courseA.id }))._getStatusCode()).toBe(200);
    expect((await call(sessionsRoute, 'GET', { courseId: courseB.id }))._getStatusCode()).toBe(403);
  });

  it('lists only the courses a staff member instructs', async () => {
    as('ta');
    const ids = (await call(coursesRoute, 'GET', {}))
      ._getJSONData()
      .courses.map((c: { id: string }) => c.id);
    expect(ids).toContain(courseA.id);
    expect(ids).not.toContain(courseB.id);
  });

  it('shows staff no profile of a student outside their course', async () => {
    as('ta');
    const res = await call(profileRoute, 'GET', {
      courseId: courseA.id,
      email: email('student-b'),
    });
    expect(res._getStatusCode()).toBe(404);
    as('owner');
    expect((await call(profileRoute, 'GET', { email: email('student-b') }))._getStatusCode()).toBe(
      200
    );
  });

  it('lets only a deployment instructor change course staff', async () => {
    as('ta');
    expect(
      (
        await call(
          courseStaffRoute,
          'POST',
          { courseId: courseA.id },
          { email: email('student-b') }
        )
      )._getStatusCode()
    ).toBe(403);
    as('owner');
    expect(
      (
        await call(
          courseStaffRoute,
          'POST',
          { courseId: courseB.id },
          { email: `student-b-${suffix}`, role: 'ta' }
        )
      )._getStatusCode()
    ).toBe(200);
    const listed = (await call(courseStaffRoute, 'GET', { courseId: courseB.id }))._getJSONData();
    expect(listed.staff.map((member: { email: string }) => member.email)).toEqual([
      email('student-b'),
    ]);
    expect(listed.canManage).toBe(true);
    expect(
      (
        await call(
          courseStaffRoute,
          'DELETE',
          { courseId: courseB.id },
          { email: email('student-b') }
        )
      )._getStatusCode()
    ).toBe(200);
    expect(
      (await call(courseStaffRoute, 'GET', { courseId: courseB.id }))._getJSONData().staff
    ).toEqual([]);
  });

  it('lets only a deployment instructor add a course, and labels each course with the role', async () => {
    as('ta');
    const refused = await call(
      coursesRoute,
      'POST',
      { courseId: courseA.id },
      { name: 'New course' }
    );
    expect(refused._getStatusCode()).toBe(403);
    const listed = (await call(coursesRoute, 'GET', {}))._getJSONData();
    expect(listed.canCreate).toBe(false);
    expect(listed.courses.find((c: { id: string }) => c.id === courseA.id).role).toBe('instructor');
    as('student-b');
    const student = (await call(coursesRoute, 'GET', {}))._getJSONData();
    expect(student.courses.map((c: { role: string }) => c.role)).toEqual(['student']);
    as('owner');
    expect((await call(coursesRoute, 'GET', {}))._getJSONData().canCreate).toBe(true);
  });

  it('cannot reach course B with course A in the query and course B in the body', async () => {
    as('ta');
    const route = adminRoutes.find((candidate) => candidate.name === 'roster')!;
    const { req, res } = createMocks({ headers: { origin: 'https://checkhen.test', 'content-type': 'application/json' },
      method: 'POST',
      query: { courseId: courseA.id },
      body: { courseId: courseB.id, email: email('student-b'), active: false },
    });
    await route.handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    // The route acted on course A, the course it checked, not course B.
    const entry = await prisma.rosterEntry.findFirst({
      where: { courseId: courseB.id, user: { email: email('student-b') } },
    });
    expect(entry?.active).toBe(true);
  });

  it('gives course staff the instructor screens', async () => {
    expect(await instructsAnyCourse(email('ta'))).toBe(true);
    expect(await instructsAnyCourse(email('student-b'))).toBe(false);
    expect(await instructsAnyCourse(email('owner'))).toBe(true);
  });
});
