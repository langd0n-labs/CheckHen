import type { EventScope } from './events';

export function selectedScope(): Partial<EventScope> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem('checkhen.scope') || '{}'); }
  catch { return {}; }
}
export function selectScope(scope: Partial<EventScope>) {
  sessionStorage.setItem('checkhen.scope', JSON.stringify(scope));
}
export function scopedFetch(input: string, init?: RequestInit): Promise<Response> {
  const scope = selectedScope();
  if (!input.startsWith('/api/') || (!scope.courseId && !scope.classId)) return globalThis.fetch(input, init);
  const url = new URL(input, window.location.origin);
  if (scope.courseId && !url.searchParams.has('courseId')) url.searchParams.set('courseId', scope.courseId);
  if (scope.classId && !url.searchParams.has('classId')) url.searchParams.set('classId', scope.classId);
  return globalThis.fetch(url.pathname + url.search, init);
}
