import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { createHmac, timingSafeEqual } from "node:crypto";

const prisma = new PrismaClient(); // Initialize Prisma client for database operations

const io = new Server(Number(process.env.PORT || 6060), {
  cors: {
    origin: "*", // Allow all origins for CORS
  },
});

// Only the authenticated application can mint a short-lived socket ticket.
const roomKey = (courseId: string, classId: string) => courseId + ':' + classId;
io.use(async (socket, next) => {
  try {
    const ticket = socket.handshake.auth.ticket;
    const [payload, signature] = typeof ticket === 'string' ? ticket.split('.') : [];
    const secret = process.env.AUTH_SECRET;
    if (!payload || !signature || !secret) throw new Error('Missing socket ticket');
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid ticket');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.expires !== 'number' || data.expires < Date.now() ||
        typeof data.courseId !== 'string' || typeof data.classId !== 'string' ||
        typeof data.userId !== 'string' || typeof data.admin !== 'boolean') throw new Error('Expired ticket');
    const selected = await prisma.class.findFirst({
      where: { id: data.classId, courseId: data.courseId },
    });
    if (!selected) throw new Error('Unknown class session');
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new Error('Unknown user');
    if (!data.admin) {
      const roster = await prisma.rosterEntry.findUnique({
        where: { courseId_userId: { courseId: data.courseId, userId: data.userId } },
      });
      if (!roster?.active) throw new Error('Inactive roster entry');
    }
    socket.data.courseId = data.courseId;
    socket.data.classId = data.classId;
    socket.data.userId = data.userId;
    next();
  } catch { next(new Error('Socket authentication failed')); }
});

// Auto-start scheduled classes every minute
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hhmm = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const templates = await prisma.classTemplate.findMany({
    where: { daysOfWeek: { has: dayOfWeek }, startTime: hhmm },
  });

  for (const t of templates) {
    // Avoid double-creating if one was already started in this minute window
    const recentClass = await prisma.class.findFirst({
      where: {
        templateId: t.id,
        createdAt: { gte: new Date(now.getTime() - 60000) },
      },
    });
    if (!recentClass) {
      await prisma.class.create({
        data: {
          name: t.name,
          duration: t.duration,
          color: t.color,
          templateId: t.id,
          courseId: t.courseId,
        },
      });
      console.log(`[cron] Auto-started class "${t.name}" from template ${t.id}`);
    }
  }
});

// Join only after scope and roster validation; never trust a broadcast room from the payload.
io.on("connection", socket => {
  const room = roomKey(socket.data.courseId, socket.data.classId);
  socket.join(room);
  const events: Record<string, string> = {
    "user-hand-update": "user-hand-update",
    "user-hand-acked": "check-raised-hands",
    "chat-message-sent": "fetch-messages",
    "pace-signal-sent": "pace-signal-update",
    "pace-signals-reset": "pace-signals-reset",
  };
  socket.onAny((event, payload) => {
    if (!events[event] || payload?.classId !== socket.data.classId ||
        (payload.courseId && payload.courseId !== socket.data.courseId)) return;
    io.to(room).emit(events[event], payload);
  });
});
