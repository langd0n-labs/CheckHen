import { createHmac } from 'node:crypto';
import { appendEvent, readState } from './event-store';
import type { EventScope } from './events';
import { PortalBindingError } from './portal-binding';
import { prisma } from './prisma';

export type ExamClient = { userId: string; mac: string };
export type ExamConnection = {
  userId: string;
  connected: boolean;
  disconnectedAt: number | null;
  failed: boolean;
};

const domainPattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function examDomains(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 50 ||
    value.some((v) => typeof v !== 'string')
  ) {
    throw new Error('Enter 1–50 allowed domains');
  }
  const domains = value.map((name: string) => name.toLowerCase().trim().replace(/\.$/, ''));
  if (domains.some((name: string) => !domainPattern.test(name))) {
    throw new Error('Invalid allowed domain');
  }
  return Array.from(new Set<string>(domains));
}

export async function examAgent(
  action: 'exam-start' | 'exam-stop' | 'exam-status' | 'exam-heartbeat',
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = process.env.PORTAL_AGENT_URL;
  const secret = process.env.PORTAL_CONTROL_SECRET;
  if (!url || !secret) {
    throw new PortalBindingError('Exam network agent is not configured', 503);
  }
  const payload = JSON.stringify({ ...body, timestamp: Date.now() });
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CheckHen-Signature': signature },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PortalBindingError('Exam network agent unavailable', 503);
  }
  if (!response.ok) {
    throw new PortalBindingError(
      'Exam network agent rejected the request',
      response.status === 403 ? 403 : 503
    );
  }
  return response.json();
}

export type ExamFailReport = { examId: string; userId: string; failId: string };

/**
 * Record one agent-detected drop. Each drop has its own failId, so a student
 * excused once can fail again; a repeated report of the same drop is stored once.
 */
export async function recordExamFail(scope: EventScope, report: ExamFailReport): Promise<void> {
  const state = await readState(prisma, scope);
  if (
    state.exam?.id !== report.examId ||
    !state.attendance.some((entry) => entry.userId === report.userId)
  ) {
    return;
  }
  await appendEvent(prisma, {
    ...scope,
    actorId: 'system:exam-monitor',
    userId: report.userId,
    kind: 'EXAM_FAILED',
    payload: { examId: report.examId, failId: report.failId },
  });
}
