import { primaryName } from './name-label';
import type { foldEvents } from './events';

type Message = ReturnType<typeof foldEvents>['messages'][number];
type Author = { name?: string | null; id: string; email: string; displayName: string | null;
  namePronunciation: string | null; pronouns: string | null };

export function projectionChat(messages: Message[]) {
  return messages.map(({ id, message, anonymousName, createdAt, fromInstructor }) =>
    ({ id, message, anonymousName, createdAt, ...(fromInstructor ? { fromInstructor } : {}) }));
}

export function studentChat(messages: Message[], viewerId: string) {
  return messages.map(message => ({ ...projectionChat([message])[0], isOwn: !message.fromInstructor && message.userId === viewerId }));
}

export function instructorChat(messages: (Message & { hidden?: boolean; hideEventId?: string | null })[], authors: Author[]) {
  const byId = new Map(authors.map(author => [author.id, author]));
  return messages.map(message => {
    const author = message.userId ? byId.get(message.userId) : undefined;
    return { ...projectionChat([message])[0], userId: message.userId,
      hidden: message.hidden === true, hideEventId: message.hideEventId ?? null,
      user: { name: author ? primaryName(author) : message.userId ? '' : 'Instructor', nickname: author?.displayName ?? null, email: author?.email ?? '', displayName: author?.displayName ?? null,
        namePronunciation: author?.namePronunciation ?? null, pronouns: author?.pronouns ?? null } };
  });
}
