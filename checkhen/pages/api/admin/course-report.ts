import type { NextApiRequest, NextApiResponse } from 'next';
import {
  configProblem,
  courseConfig,
  DEFAULT_CONFIG,
  type ColdCallConfig,
  type Meeting,
} from '@/lib/cold-call';
import { courseReport, sessionsCsv, studentsCsv } from '@/lib/course-report';
import { appendEvent, asEvent, ConflictError, isEffective } from '@/lib/event-store';
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

/**
 * Merge the given settings into the course's current ones. Unknown keys and
 * unusable values are refused with a message the instructor can act on.
 */
function mergeConfig(
  value: unknown,
  current: ColdCallConfig
): { config: ColdCallConfig } | { problem: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { problem: 'Send the settings as an object' };
  }
  for (const [key, given] of Object.entries(value as Record<string, unknown>)) {
    // hasOwn, so inherited names such as toString or __proto__ are not settings.
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
      return { problem: `Unknown setting: ${key}` };
    }
    if (key === 'term_meetings') {
      if (given !== null && !(Number.isInteger(given) && (given as number) > 0)) {
        return { problem: 'Meetings in the term must be a whole number of at least 1, or empty' };
      }
    } else if (typeof given !== 'number' || !Number.isFinite(given) || given < 0) {
      return { problem: `Enter a number of at least 0 for ${key}` };
    }
  }
  // Keys left out keep their current values.
  const config = { ...current, ...(value as Partial<ColdCallConfig>) };
  const problem = configProblem(config);
  return problem ? { problem } : { config };
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
  const { config, problem: storedProblem } = courseConfig(course.config);

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
      // The byte-order mark makes Excel read the file as UTF-8, so accented names survive.
      return res.status(200).send(`\uFEFF${csv}`);
    }
    return res.json({
      course: { id: course.id, name: course.name },
      config,
      defaults: DEFAULT_CONFIG,
      // Set when the saved settings break the grade and the defaults are in use.
      configProblem: storedProblem,
      report,
    });
  }

  if (req.body?.action === 'config') {
    const merged = mergeConfig(req.body.config, config);
    if ('problem' in merged) {
      return res.status(400).json({ message: merged.problem });
    }
    await prisma.course.update({ where: { id: course.id }, data: { config: merged.config } });
    return res.json({ config: merged.config });
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
          // An absence whose excuse was undone counts again and may be excused again.
          if (!(await isEffective(tx, scope, call.id))) {
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

  if (req.body?.action === 'unexcuse') {
    const { classId, callId } = req.body;
    const scope = { courseId: course.id, classId: String(classId) };
    const excuses = await prisma.participationEvent.findMany({
      where: { ...scope, kind: 'COLD_CALL_EXCUSED', supersedesId: String(callId) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!excuses.length) {
      return res.status(404).json({ message: 'Excuse not found' });
    }
    try {
      // The UNDO supersedes the excuse, so the Absent call is in force again.
      await appendEvent(prisma, {
        ...scope,
        actorId: identity.user.id,
        userId: excuses[0].userId,
        kind: 'UNDO',
        supersedesId: excuses[0].id,
        guard: async (tx) => {
          if (!(await isEffective(tx, scope, excuses[0].id))) {
            throw new ConflictError('This excuse is already undone');
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
