import { instructorChat, projectionChat, studentChat } from '@/lib/chat-view';

const message = { id: 'message', userId: 'student', classId: 'class', message: 'Question?',
  anonymousName: 'Swift Panda', createdAt: new Date('2026-10-04T18:00:00Z') };
const author = { id: 'student', email: 'student@example.edu', displayName: 'Student Name',
  namePronunciation: null, pronouns: null };

it('shows anonymous names to students and marks only their own message', () => {
  expect(studentChat([message], 'student')[0]).toMatchObject({ anonymousName: 'Swift Panda', isOwn: true });
  expect(studentChat([message], 'other')[0].isOwn).toBe(false);
  expect(JSON.stringify(studentChat([message], 'other'))).not.toContain('student@example.edu');
  expect(studentChat([message], 'other')[0]).not.toHaveProperty('userId');
});

it('shows the real student only to the instructor', () => {
  expect(instructorChat([message], [author])[0]).toMatchObject({
    anonymousName: 'Swift Panda', userId: 'student', user: { email: 'student@example.edu', displayName: 'Student Name' },
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
