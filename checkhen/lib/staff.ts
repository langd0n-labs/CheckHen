import { isDemo } from './demo';
import { isInstructor } from './instructor';
import { prisma } from './prisma';

/**
 * Course staff instruct only their own courses. The deployment's instructors
 * (ADMIN_EMAILS) instruct every course. The demo has only its seeded instructor.
 */
export async function isCourseStaff(userId: string, courseId: string): Promise<boolean> {
  if (isDemo()) return false;
  return !!(await prisma.courseStaff.findUnique({
    where: { courseId_userId: { courseId, userId } },
  }));
}

/** True for a deployment instructor, or for someone on any course's staff. */
export async function instructsAnyCourse(email: string): Promise<boolean> {
  if (isInstructor(email)) return true;
  if (isDemo()) return false;
  return (await prisma.courseStaff.count({ where: { user: { email } } })) > 0;
}

/** The users who instruct this course: its staff. Deployment instructors are checked by email. */
export async function courseStaffIds(courseId: string): Promise<Set<string>> {
  if (isDemo()) return new Set();
  const staff = await prisma.courseStaff.findMany({
    where: { courseId },
    select: { userId: true },
  });
  return new Set(staff.map((entry) => entry.userId));
}
