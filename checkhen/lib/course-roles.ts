import { scopedFetch } from './scoped-fetch';

/** True when the signed-in person takes at least one course here as a student. */
export async function takesACourse(): Promise<boolean> {
  const response = await scopedFetch('/api/courses');
  if (!response.ok) return false;
  const { courses } = await response.json();
  return courses.some((course: { role?: string }) => course.role === 'student');
}
