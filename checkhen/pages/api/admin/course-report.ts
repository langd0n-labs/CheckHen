import type { NextApiRequest, NextApiResponse } from 'next';
import { DEFAULT_CONFIG, resolveConfig, type ColdCallConfig, type Meeting } from '@/lib/cold-call';
import { courseReport, sessionsCsv, studentsCsv } from '@/lib/course-report';
import { appendEvent, asEvent, ConflictError } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';

/** Held sessions of the course, their events, and the active roster. */
async function loadReport(courseId: string, config: ColdCallConfig) {
  const sessions = await prisma.class.findMany({
    where: { courseId, createdAt: { lte: new Date() } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, createdAt: true },
  });
  const events = (
    await prisma.participationEvent.findMany({
      where: { courseId, classId: { in: sessions.map((session) => session.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  const meetings: Meeting[] = sessions.map((session) => ({
    courseId,
    classId: session.id,
    events: events.filter((event) => event.classId === session.id),
  }));
  const roster = await prisma.rosterEntry.findMany({
    where: { courseId, active: true },
    include: { user: true },
  });
  return courseReport(
    meetings,
    sessions.map((session) => ({
      classId: session.id,
      name: session.name,
      startedAt: session.createdAt,
    })),
    roster
      .map((entry) => ({
        userId: entry.userId,
        name: entry.user.displayName || entry.user.email.split('@')[0],
        email: entry.user.email,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId)),
    config
  );
}

/** Accept only known keys, and only values the grade code would use as given. */
function validConfig(value: unknown): ColdCallConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => !(key in DEFAULT_CONFIG))) {
    return null;
  }
  const config = resolveConfig(value);
  return entries.every(([key, given]) => config[key as keyof ColdCallConfig] === given)
    ? config
    : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }
  const identity = await requireIdentity(req, res, true);
  if (!identity) {
    return;
  }
  const courseId = req.query.courseId ?? req.body?.courseId;
  const course =
    typeof courseId === 'string'
      ? await prisma.course.findUnique({ where: { id: courseId } })
      : null;
  if (!course) {
    return res.status(404).json({ message: 'Course not found' });
  }
  const config = resolveConfig(course.config);

  if (req.method === 'GET') {
    const report = await loadReport(course.id, config);
    const view = req.query.format === 'csv' ? req.query.view : null;
    if (view === 'students' || view === 'sessions') {
      const exportedAt = new Date();
      const csv =
        view === 'students'
          ? studentsCsv(report, config, exportedAt)
          : sessionsCsv(report, config, exportedAt);
      const date = exportedAt.toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="checkhen-${view}-${date}.csv"`);
      return res.status(200).send(csv);
    }
    return res.json({
      course: { id: course.id, name: course.name },
      config,
      defaults: DEFAULT_CONFIG,
      report,
    });
  }

  if (req.body?.action === 'config') {
    const next = validConfig(req.body.config);
    if (!next) {
      return res.status(400).json({ message: 'Check the settings: one is not a valid value' });
    }
    if (next.A_min > next.A_max) {
      return res.status(400).json({ message: 'The lowest A must not exceed the highest A' });
    }
    await prisma.course.update({ where: { id: course.id }, data: { config: next } });
    return res.json({ config: next });
  }

  if (req.body?.action === 'excuse') {
    const { classId, callId, reason } = req.body;
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      return res.status(400).json({ message: 'Enter a reason' });
    }
    const call = await prisma.participationEvent.findFirst({
      where: {
        courseId: course.id,
        classId: String(classId),
        id: String(callId),
        kind: 'COLD_CALL',
      },
    });
    if (!call || (call.payload as { outcome?: string }).outcome !== 'absent') {
      return res.status(404).json({ message: 'Absence not found' });
    }
    const scope = { courseId: course.id, classId: call.classId };
    try {
      await appendEvent(prisma, {
        ...scope,
        actorId: identity.user.id,
        userId: call.userId,
        kind: 'COLD_CALL_EXCUSED',
        payload: { reason: reason.trim() },
        supersedesId: call.id,
        guard: async (tx) => {
          if (
            await tx.participationEvent.findFirst({ where: { ...scope, supersedesId: call.id } })
          ) {
            throw new ConflictError('This absence is already excused or undone');
          }
        },
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }
    return res.json({ ok: true });
  }

  return res.status(400).json({ message: 'Unknown course record action' });
}
