import { registerChatJump } from '../../../socket-server/src/chat-jump';

function connect(data: {
  admin?: boolean;
  projection?: boolean;
  userId?: string;
  classId: string;
}) {
  let receive: (payload: unknown) => void = () => {};
  const broadcast = jest.fn();
  const on = jest.fn((_event, handler) => {
    receive = handler;
  });
  registerChatJump({ data, on }, broadcast);
  expect(on).toHaveBeenCalledWith('chat-jump', expect.any(Function));
  return { receive: (payload: unknown) => receive(payload), broadcast };
}

it('uses the verified instructor scope and broadcasts only class and message IDs', () => {
  const { receive, broadcast } = connect({ admin: true, userId: 'instructor', classId: 'class-a' });
  receive({ messageId: 'message', classId: 'class-b', courseId: 'other', userId: 'student' });
  expect(broadcast).toHaveBeenCalledWith('chat-jump', { classId: 'class-a', messageId: 'message' });
  expect(broadcast).toHaveBeenCalledTimes(1);
});

it.each([
  { admin: false, userId: 'student', classId: 'class-a' },
  { admin: false, projection: true, classId: 'class-a' },
  { admin: true, projection: true, userId: 'instructor', classId: 'class-a' },
  { admin: true, classId: 'class-a' },
])('refuses a socket without instructor identity: %j', (data) => {
  const { receive, broadcast } = connect(data);
  receive({ messageId: 'message', admin: true, userId: 'instructor' });
  expect(broadcast).not.toHaveBeenCalled();
});

it.each([null, undefined, 'message', {}, { messageId: 1 }, { messageId: '' }, { messageId: ' ' }])(
  'ignores malformed events: %j',
  (payload) => {
    const { receive, broadcast } = connect({
      admin: true,
      userId: 'instructor',
      classId: 'class-a',
    });
    receive(payload);
    expect(broadcast).not.toHaveBeenCalled();
  }
);
