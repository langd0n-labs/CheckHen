import { instructorChat, projectionChat, studentChat } from '@/lib/chat-view';

const message = { id: 'message', userId: 'student', classId: 'class', message: 'Question?',
  anonymousName: 'Swift Panda', createdAt: new Date('2026-10-04T18:00:00Z') };
const author = { id: 'student', email: 'student@example.edu', name: 'Alice Canonical', displayName: 'Ace',
  namePronunciation: null, pronouns: null };

it('shows anonymous names to students and marks only their own message', () => {
  expect(studentChat([message], 'student')[0]).toMatchObject({ anonymousName: 'Swift Panda', isOwn: true });
  expect(studentChat([message], 'other')[0].isOwn).toBe(false);
  expect(JSON.stringify(studentChat([message], 'other'))).not.toContain('student@example.edu');
  expect(studentChat([message], 'other')[0]).not.toHaveProperty('userId');
});

it('shows the real student only to the instructor', () => {
  expect(instructorChat([message], [author])[0]).toMatchObject({
    anonymousName: 'Swift Panda', userId: 'student', user: { email: 'student@example.edu', name: 'Alice Canonical', nickname: 'Ace', displayName: 'Ace' },
  });
});

it('flags a hidden message for the instructor without exposing it to projection', () => {
  const hidden = { ...message, hidden: true, hideEventId: 'hide-1' };
  expect(instructorChat([hidden], [author])[0]).toMatchObject({ hidden: true, hideEventId: 'hide-1' });
  expect(projectionChat([])).toEqual([]);
});

it('keeps the projection payload anonymous for both I5 and I6', () => {
  const projected = projectionChat([message]);
  expect(projected).toEqual([{ id: 'message', message: 'Question?', anonymousName: 'Swift Panda',
    createdAt: message.createdAt }]);
  expect(JSON.stringify(projected)).not.toContain('student');
});

it('strips all identity fields even when an input contains trusted and custom names', () => {
  const identified = { ...message, name: author.name, nickname: author.displayName, user: author };
  for (const payload of [projectionChat([identified]), studentChat([identified], 'student')]) {
    const serialized = JSON.stringify(payload);
    for (const secret of [author.name, author.displayName, author.email]) expect(serialized).not.toContain(secret);
  }
});

it('carries the instructor label without author identity in public views', () => {
  const instructor = { ...message, fromInstructor: true as const, anonymousName: 'Instructor', userId: null };
  for (const result of [projectionChat([instructor])[0], studentChat([instructor], 'student')[0]]) {
    expect(result).toMatchObject({ anonymousName: 'Instructor', fromInstructor: true });
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('user');
    expect(JSON.stringify(result)).not.toContain('teacher');
  }
  expect(instructorChat([instructor], [author])[0]).toMatchObject({ userId: null, fromInstructor: true, user: { name: 'Instructor' } });
  expect(studentChat([instructor], 'teacher')[0].isOwn).toBe(false);
  expect(studentChat([{ ...instructor, userId: 'teacher' }], 'teacher')[0].isOwn).toBe(false);
  expect(studentChat([message], 'student')[0]).not.toHaveProperty('fromInstructor');
});
