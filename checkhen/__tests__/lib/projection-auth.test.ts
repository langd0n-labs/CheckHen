import { mintProjectionTicket, verifyProjectionTicket } from '@/lib/projection-auth';

const scope = { courseId: 'course', classId: 'class' };
const secret = 'test-secret';

it('verifies only the signed class scope before expiry', () => {
  const ticket = mintProjectionTicket(scope, 2000, secret);
  expect(verifyProjectionTicket(ticket, secret, 1000)).toEqual({ ...scope, projection: true, expires: 2000 });
  expect(verifyProjectionTicket(ticket, secret, 2000)).toBeNull();
});

it('rejects a changed scope, wrong secret, and malformed ticket', () => {
  const ticket = mintProjectionTicket(scope, 2000, secret);
  const [payload, signature] = ticket.split('.');
  const changed = Buffer.from(JSON.stringify({ ...scope, classId: 'other', projection: true, expires: 2000 }))
    .toString('base64url');
  expect(verifyProjectionTicket(`${changed}.${signature}`, secret, 1000)).toBeNull();
  expect(verifyProjectionTicket(ticket, 'other', 1000)).toBeNull();
  expect(verifyProjectionTicket(`${payload}.bad`, secret, 1000)).toBeNull();
});
