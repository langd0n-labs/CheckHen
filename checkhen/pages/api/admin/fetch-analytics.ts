import type { NextApiRequest, NextApiResponse } from 'next';
import { isInstructor, requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';
import { readState } from '@/lib/event-store';

type StudentSummary = {
  email: string;
  displayName: string | null;
  anonymousName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
  handRaiseCount: number;
  paceSignal: string | null;
  engagementScore: number | null;
};

type TemplateOption = {
  id: string;
  name: string;
  color: string;
};

type PaceTimelineBucket = {
  minutesBucket: number;
  slowDown: number;
  readyToMove: number;
};

type LeaveEvent = {
  displayName: string | null;
  anonymousName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
  leftEarly: boolean;
};

type AggregatedStats = {
  totalStudents: number;
  avgDurationMinutes: number;
  absentMoreThan50Percent: number;
  avgMessagesPerStudent: number;
  avgHandRaisesPerStudent: number;
  paceSignalTimeline: PaceTimelineBucket[];
  leaveEvents: LeaveEvent[];
};

type AnalyticsResponse = {
  students: StudentSummary[];
  paceAggregate: { slow_down: number; ready_to_move_on: number };
  classes: { id: string; name: string; createdAt: string; duration: number; color: string | null }[];
  selectedClass: { id: string; name: string; createdAt: string; duration: number; color: string | null } | null;
  aggregated?: AggregatedStats;
  // All-time mode extras
  allTime?: boolean;
  template?: TemplateOption | null;
  sessionCount?: number;
  totalPlannedMinutes?: number;
  templates?: TemplateOption[];
};

type ErrorResponse = { message: string };

const BUCKET_SIZE = 5; // minutes

function bucketPaceSignals(
  paceSignals: { signalType: string; createdAt: Date }[],
  classStart: Date,
  classDuration: number,
): PaceTimelineBucket[] {
  const numBuckets = Math.ceil(classDuration / BUCKET_SIZE) + 1;
  const buckets = new Map<number, { slowDown: number; readyToMove: number }>();
  for (let i = 0; i < numBuckets; i++) {
    buckets.set(i * BUCKET_SIZE, { slowDown: 0, readyToMove: 0 });
  }

  for (const signal of paceSignals) {
    let minutesFromStart = (signal.createdAt.getTime() - classStart.getTime()) / 60000;
    minutesFromStart = Math.max(0, Math.min(minutesFromStart, classDuration));
    const key = Math.floor(minutesFromStart / BUCKET_SIZE) * BUCKET_SIZE;
    const bucket = buckets.get(key)!;
    if (signal.signalType === 'slow_down') bucket.slowDown++;
    else if (signal.signalType === 'ready_to_move_on') bucket.readyToMove++;
  }

  const result: PaceTimelineBucket[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([minutesBucket, counts]) => ({ minutesBucket, ...counts }));

  // Trim trailing all-zero buckets (keep at least one)
  while (result.length > 1 && result[result.length - 1].slowDown === 0 && result[result.length - 1].readyToMove === 0) {
    result.pop();
  }

  return result;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyticsResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  if (!(await requireIdentity(req, res, true))) return;

  const courseId = req.query.courseId;
  if (typeof courseId !== 'string' || !await prisma.course.findUnique({ where: { id: courseId } })) {
    return res.status(400).json({ message: 'Select a course' });
  }
  const participation = async (classIds: string[]) => {
    const states = await Promise.all(classIds.map(classId => readState(prisma, { courseId, classId })));
    const entries = states.flatMap(state => state.attendance);
    const users = await prisma.user.findMany({ where: { id: { in: entries.map(entry => entry.userId) } } });
    const checkIns = entries.flatMap(entry => {
      const user = users.find(candidate => candidate.id === entry.userId);
      return user && !isInstructor(user.email) ? [{ ...entry, updatedAt: null, user }] : [];
    });
    return {
      checkIns,
      handRaises: states.flatMap(state => state.hands),
      paceSignals: states.flatMap(state => state.pace),
      messages: states.flatMap(state => state.messages),
    };
  };

  // Fetch all classes for the selector (most recent first, include color)
  const allClasses = await prisma.class.findMany({
    where: { courseId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const classesSerialized = allClasses.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    duration: c.duration,
    color: c.color,
  }));

  // Fetch all templates for the "All Sessions" options
  const allTemplates = await prisma.classTemplate.findMany({ where: { courseId }, orderBy: { name: 'asc' } });
  const templateOptions: TemplateOption[] = allTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  const { classId, templateId, allTime } = req.query;

  // ── All-time aggregation mode ──────────────────────────────────────────────
  if (allTime === 'true' && typeof templateId === 'string') {
    const template = allTemplates.find((t) => t.id === templateId);
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const templateClasses = await prisma.class.findMany({
      where: { templateId, courseId },
      orderBy: { createdAt: 'asc' },
    });

    if (templateClasses.length === 0) {
      return res.status(200).json({
        students: [],
        paceAggregate: { slow_down: 0, ready_to_move_on: 0 },
        classes: classesSerialized,
        selectedClass: null,
        allTime: true,
        template: { id: template.id, name: template.name, color: template.color },
        sessionCount: 0,
        totalPlannedMinutes: 0,
        templates: templateOptions,
      });
    }

    const classIds = templateClasses.map((c) => c.id);
    const totalPlannedMinutes = templateClasses.reduce((sum, c) => sum + c.duration, 0);

    const { checkIns, handRaises, paceSignals } = await participation(classIds);
    const handRaiseCounts: Record<string, number> = {};
    for (const hr of handRaises) {
      handRaiseCounts[hr.userId] = (handRaiseCounts[hr.userId] ?? 0) + 1;
    }

    paceSignals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latestPaceSignal: Record<string, string> = {};
    for (const ps of paceSignals) {
      if (!latestPaceSignal[ps.userId]) latestPaceSignal[ps.userId] = ps.signalType;
    }

    // Aggregate per student across all sessions
    const studentMap: Record<string, {
      email: string;
      displayName: string | null;
      anonymousName: string | null;
      firstCheckIn: string;
      lastCheckOut: string | null;
      totalMinutes: number | null;
      hasIncompleteCheckout: boolean;
    }> = {};

    for (const ci of checkIns) {
      const uid = ci.userId;
      const durationMinutes = ci.checkOutTime
        ? Math.round((ci.checkOutTime.getTime() - ci.createdAt.getTime()) / 60000)
        : null;

      if (!studentMap[uid]) {
        studentMap[uid] = {
          email: ci.user.email,
          displayName: ci.user.displayName ?? null,
          anonymousName: ci.anonymousName,
          firstCheckIn: ci.createdAt.toISOString(),
          lastCheckOut: ci.checkOutTime?.toISOString() ?? null,
          totalMinutes: durationMinutes,
          hasIncompleteCheckout: durationMinutes === null,
        };
      } else {
        const s = studentMap[uid];
        if (new Date(ci.createdAt) < new Date(s.firstCheckIn)) {
          s.firstCheckIn = ci.createdAt.toISOString();
        }
        if (ci.checkOutTime) {
          if (!s.lastCheckOut || new Date(ci.checkOutTime) > new Date(s.lastCheckOut)) {
            s.lastCheckOut = ci.checkOutTime.toISOString();
          }
        } else {
          s.hasIncompleteCheckout = true;
        }
        if (durationMinutes !== null && s.totalMinutes !== null) {
          s.totalMinutes += durationMinutes;
        } else if (durationMinutes === null) {
          s.hasIncompleteCheckout = true;
        }
      }
    }

    const paceAggregate = { slow_down: 0, ready_to_move_on: 0 };
    for (const signalType of Object.values(latestPaceSignal)) {
      if (signalType === 'slow_down') paceAggregate.slow_down++;
      else if (signalType === 'ready_to_move_on') paceAggregate.ready_to_move_on++;
    }

    const students: StudentSummary[] = Object.entries(studentMap).map(([uid, s]) => {
      const handRaiseCount = handRaiseCounts[uid] ?? 0;
      const hasPaceSignal = !!latestPaceSignal[uid];
      let engagementScore: number | null = null;

      if (!s.hasIncompleteCheckout && s.totalMinutes !== null) {
        const timeScore = Math.min(s.totalMinutes / totalPlannedMinutes, 1) * 60;
        const handScore = Math.min(handRaiseCount, 5) * 6;
        const paceScore = hasPaceSignal ? 10 : 0;
        engagementScore = Math.round(timeScore + handScore + paceScore);
      }

      return {
        email: s.email,
        displayName: s.displayName,
        anonymousName: s.anonymousName,
        checkInTime: s.firstCheckIn,
        checkOutTime: s.lastCheckOut,
        durationMinutes: s.totalMinutes,
        handRaiseCount,
        paceSignal: latestPaceSignal[uid] ?? null,
        engagementScore,
      };
    });

    students.sort((a, b) => {
      if (a.engagementScore === null && b.engagementScore === null) return 0;
      if (a.engagementScore === null) return 1;
      if (b.engagementScore === null) return -1;
      return b.engagementScore - a.engagementScore;
    });

    return res.status(200).json({
      students,
      paceAggregate,
      classes: classesSerialized,
      selectedClass: null,
      allTime: true,
      template: { id: template.id, name: template.name, color: template.color },
      sessionCount: templateClasses.length,
      totalPlannedMinutes,
      templates: templateOptions,
    });
  }

  // ── Per-session mode (default) ─────────────────────────────────────────────
  const { classId: _ignored, ...rest } = req.query;
  void rest;

  const targetClass = typeof classId === 'string'
    ? allClasses.find((c) => c.id === classId)
    : null;

  if (!targetClass) {
    return res.status(200).json({
      students: [],
      paceAggregate: { slow_down: 0, ready_to_move_on: 0 },
      classes: classesSerialized,
      selectedClass: null,
      templates: templateOptions,
    });
  }

  const { checkIns, handRaises, paceSignals, messages } = await participation([targetClass.id]);
  const handRaiseCounts: Record<string, number> = {};
  for (const hr of handRaises) {
    handRaiseCounts[hr.userId] = (handRaiseCounts[hr.userId] ?? 0) + 1;
  }

  paceSignals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestPaceSignal: Record<string, string> = {};
  for (const ps of paceSignals) {
    if (!latestPaceSignal[ps.userId]) latestPaceSignal[ps.userId] = ps.signalType;
  }

  const paceAggregate = { slow_down: 0, ready_to_move_on: 0 };
  for (const signalType of Object.values(latestPaceSignal)) {
    if (signalType === 'slow_down') paceAggregate.slow_down++;
    else if (signalType === 'ready_to_move_on') paceAggregate.ready_to_move_on++;
  }

  const students: StudentSummary[] = checkIns.map((checkIn) => {
    const durationMinutes = checkIn.checkOutTime
      ? Math.round((checkIn.checkOutTime.getTime() - checkIn.createdAt.getTime()) / 60000)
      : null;

    const handRaiseCount = handRaiseCounts[checkIn.userId] ?? 0;
    const hasPaceSignal = !!latestPaceSignal[checkIn.userId];

    let engagementScore: number | null = null;
    if (durationMinutes !== null) {
      const timeScore = Math.min(durationMinutes / targetClass.duration, 1) * 60;
      const handScore = Math.min(handRaiseCount, 5) * 6;
      const paceScore = hasPaceSignal ? 10 : 0;
      engagementScore = Math.round(timeScore + handScore + paceScore);
    }

    return {
      email: checkIn.user.email,
      displayName: checkIn.user.displayName ?? null,
      anonymousName: checkIn.anonymousName,
      checkInTime: checkIn.createdAt.toISOString(),
      checkOutTime: checkIn.checkOutTime?.toISOString() ?? null,
      durationMinutes,
      handRaiseCount,
      paceSignal: latestPaceSignal[checkIn.userId] ?? null,
      engagementScore,
    };
  });

  students.sort((a, b) => {
    if (a.engagementScore === null && b.engagementScore === null) return 0;
    if (a.engagementScore === null) return 1;
    if (b.engagementScore === null) return -1;
    return b.engagementScore - a.engagementScore;
  });

  // ── Aggregated stats ───────────────────────────────────────────────────────
  const totalMessages = messages.length;
  const totalHandRaises = Object.values(handRaiseCounts).reduce((sum, n) => sum + n, 0);

  const studentsWithDuration = students.filter((s) => s.durationMinutes !== null);
  const avgDurationMinutes = studentsWithDuration.length > 0
    ? Math.round((studentsWithDuration.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0) / studentsWithDuration.length) * 10) / 10
    : 0;
  const absentMoreThan50Percent = students.filter(
    (s) => s.durationMinutes !== null && s.durationMinutes < targetClass.duration * 0.5,
  ).length;

  const paceSignalTimeline = bucketPaceSignals(paceSignals, targetClass.createdAt, targetClass.duration);

  const leaveEvents: LeaveEvent[] = checkIns.map((ci) => {
    const durationMinutes = ci.checkOutTime
      ? Math.round((ci.checkOutTime.getTime() - ci.createdAt.getTime()) / 60000)
      : null;
    return {
      displayName: ci.user.displayName ?? null,
      anonymousName: ci.anonymousName,
      checkInTime: ci.createdAt.toISOString(),
      checkOutTime: ci.checkOutTime?.toISOString() ?? null,
      durationMinutes,
      leftEarly: durationMinutes !== null && durationMinutes < targetClass.duration * 0.95,
    };
  });
  leaveEvents.sort((a, b) => new Date(a.checkInTime).getTime() - new Date(b.checkInTime).getTime());

  const aggregated: AggregatedStats = {
    totalStudents: students.length,
    avgDurationMinutes,
    absentMoreThan50Percent,
    avgMessagesPerStudent: students.length > 0 ? Math.round((totalMessages / students.length) * 10) / 10 : 0,
    avgHandRaisesPerStudent: students.length > 0 ? Math.round((totalHandRaises / students.length) * 10) / 10 : 0,
    paceSignalTimeline,
    leaveEvents,
  };

  return res.status(200).json({
    students,
    paceAggregate,
    classes: classesSerialized,
    selectedClass: {
      id: targetClass.id,
      name: targetClass.name,
      createdAt: targetClass.createdAt.toISOString(),
      duration: targetClass.duration,
      color: targetClass.color,
    },
    aggregated,
    templates: templateOptions,
  });
}
