import { DEMO_INSTRUCTOR, isDemo } from './demo';

/** The one instructor check. Every route and the sign-in callbacks use it. */
export function isInstructor(email: string) {
  // In demo mode the seeded instructor persona is the only instructor.
  if (isDemo()) return email === DEMO_INSTRUCTOR;
  const domain = process.env.NEXT_PUBLIC_EMAIL_DOMAIN || 'bu.edu';
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.includes('@') ? value : value + '@' + domain))
    .includes(email);
}
