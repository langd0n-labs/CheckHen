import { createHmac } from 'node:crypto';
import { mintProjectionTicket, verifyProjectionTicket } from '@/lib/projection-auth';

const scope = { courseId: 'course', classId: 'class' };
const secret = 'test-secret';

it('verifies only the signed class scope before expiry', () => {
  const ticket = mintProjectionTicket(scope, 2000, 3, secret);
  expect(verifyProjectionTicket(ticket, secret, 1000)).toEqual({
    ...scope,
    typ: 'projection',
    projection: true,
    expires: 2000,
    generation: 3,
  });
  expect(verifyProjectionTicket(ticket, secret, 2000)).toBeNull();
});

it('rejects a changed scope, wrong secret, and malformed ticket', () => {
  const ticket = mintProjectionTicket(scope, 2000, 0, secret);
  const [payload, signature] = ticket.split('.');
  const changed = Buffer.from(
    JSON.stringify({
      ...scope,
      classId: 'other',
      typ: 'projection',
      projection: true,
      expires: 2000,
      generation: 0,
    })
  ).toString('base64url');
  expect(verifyProjectionTicket(`${changed}.${signature}`, secret, 1000)).toBeNull();
  expect(verifyProjectionTicket(ticket, 'other', 1000)).toBeNull();
  expect(verifyProjectionTicket(`${payload}.bad`, secret, 1000)).toBeNull();
  expect(verifyProjectionTicket(ticket, null, 1000)).toBeNull();
});

it('rejects a signed claim of another type or without a generation', () => {
  const signed = (claim: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  };
  const base = { ...scope, projection: true, expires: 2000 };
  expect(
    verifyProjectionTicket(signed({ ...base, typ: 'socket', generation: 0 }), secret, 1000)
  ).toBeNull();
  expect(verifyProjectionTicket(signed({ ...base, generation: 0 }), secret, 1000)).toBeNull();
  expect(verifyProjectionTicket(signed({ ...base, typ: 'projection' }), secret, 1000)).toBeNull();
});
