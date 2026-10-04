import type { foldEvents } from './events';

type Message = ReturnType<typeof foldEvents>['messages'][number];
type Author = { id: string; email: string; displayName: string | null;
  namePronunciation: string | null; pronouns: string | null };

export function projectionChat(messages: Message[]) {
  return messages.map(({ id, message, anonymousName, createdAt }) =>
    ({ id, message, anonymousName, createdAt }));
}

export function studentChat(messages: Message[], viewerId: string) {
  return messages.map(message => ({ ...projectionChat([message])[0], isOwn: message.userId === viewerId }));
}

export function instructorChat(messages: Message[], authors: Author[]) {
  const byId = new Map(authors.map(author => [author.id, author]));
  return messages.map(message => {
    const author = byId.get(message.userId);
    return { ...projectionChat([message])[0], userId: message.userId,
      user: { email: author?.email ?? '', displayName: author?.displayName ?? null,
        namePronunciation: author?.namePronunciation ?? null, pronouns: author?.pronouns ?? null } };
  });
}
