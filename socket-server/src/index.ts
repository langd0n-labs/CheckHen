import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { createHmac, timingSafeEqual } from "node:crypto";

const prisma = new PrismaClient(); // Initialize Prisma client for database operations

const io = new Server(Number(process.env.PORT || 6060), {
  cors: {
    origin: process.env.NEXTAUTH_URL || "http://localhost:3000",
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
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    const body = JSON.stringify({ timestamp: Date.now() });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    try {
      await fetch(process.env.APP_INTERNAL_URL || 'http://app:3000/api/internal/expire-sessions', {
        method: 'POST', body, headers: { 'Content-Type': 'application/json',
          'X-CheckHen-Signature': signature }, signal: AbortSignal.timeout(10000),
      });
    } catch (error) { console.error('Session expiry request failed', error); }
  }
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

// Join only after scope and roster validation. Client messages cannot request broadcasts.
io.on("connection", socket => {
  const room = roomKey(socket.data.courseId, socket.data.classId);
  socket.join(room);
});

const notifications: Record<string, string> = {
  HAND_RAISED: "user-hand-update", HAND_LOWERED: "user-hand-update",
  HAND_ACKNOWLEDGED: "check-raised-hands", HAND_RATED: "check-raised-hands",
  CHAT_MESSAGE: "fetch-messages", PACE_SIGNAL: "pace-signal-update",
  PACE_RESET: "pace-signals-reset",
};
let cursor = new Date();
let cursorId = "";
let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    const events = await prisma.participationEvent.findMany({
      where: { OR: [{ createdAt: { gt: cursor } }, { createdAt: cursor, id: { gt: cursorId } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500,
    });
    for (const event of events) {
      cursor = event.createdAt;
      cursorId = event.id;
      const notification = notifications[event.kind];
      if (notification) io.to(roomKey(event.courseId, event.classId)).emit(notification, { classId: event.classId });
    }
  } catch (error) {
    console.error("Socket event polling failed", error);
  } finally {
    polling = false;
  }
}, 1000);
