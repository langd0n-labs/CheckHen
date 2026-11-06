type JumpSocket = {
  data: {
    admin?: boolean;
    projection?: boolean;
    userId?: string;
    classId: string;
  };
  on: (event: string, handler: (payload: unknown) => void) => unknown;
};

export function registerChatJump(
  socket: JumpSocket,
  broadcast: (
    event: string,
    payload: { classId: string; messageId: string },
  ) => void,
) {
  socket.on("chat-jump", (payload) => {
    if (!socket.data.admin || socket.data.projection || !socket.data.userId)
      return;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("messageId" in payload) ||
      typeof payload.messageId !== "string" ||
      !payload.messageId.trim()
    )
      return;
    broadcast("chat-jump", {
      classId: socket.data.classId,
      messageId: payload.messageId,
    });
  });
}
