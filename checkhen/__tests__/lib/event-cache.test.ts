import { cachedEventCounts, readEvents } from '@/lib/event-store';

type Row = {
  id: string;
  courseId: string;
  classId: string;
  userId: string | null;
  actorId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  supersedesId: string | null;
};

/** An in-memory stand-in for the event table that answers the two queries readEvents makes. */
function fakeDb() {
  const rows: Row[] = [];
  const findMany = jest.fn(async ({ where }: any) => {
    const after = where.OR as
      | [{ createdAt: { gt: Date } }, { createdAt: Date; id: { gt: string } }]
      | undefined;
    return rows
      .filter((row) => row.courseId === where.courseId && row.classId === where.classId)
      .filter(
        (row) =>
          !after ||
          row.createdAt > after[0].createdAt.gt ||
          (row.createdAt.getTime() === after[1].createdAt.getTime() && row.id > after[1].id.gt)
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  });
  const add = (id: string, at: number, classId = 'class-a') =>
    rows.push({
      id,
      courseId: 'course',
      classId,
      userId: 'student',
      actorId: 'student',
      kind: 'HAND_RAISED',
      payload: {},
      createdAt: new Date(at),
      supersedesId: null,
    });
  return { db: { participationEvent: { findMany } } as any, add, findMany };
}

const scope = { courseId: 'course', classId: 'class-a' };
const ids = (events: { id: string }[]) => events.map((event) => event.id);

beforeEach(() => {
  process.env.CHECKHEN_EVENT_CACHE = '1';
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(() => {
  delete process.env.CHECKHEN_EVENT_CACHE;
  jest.restoreAllMocks();
});

it('reads only the events after the last one it holds', async () => {
  const { db, add, findMany } = fakeDb();
  add('e1', 1000);
  add('e2', 2000);
  expect(ids(await readEvents(db, scope))).toEqual(['e1', 'e2']);
  add('e3', 3000);
  expect(ids(await readEvents(db, scope))).toEqual(['e1', 'e2', 'e3']);
  expect(findMany.mock.calls[1][0].where.OR[0].createdAt.gt).toEqual(new Date(2000));
  expect(ids(await readEvents(db, scope))).toEqual(['e1', 'e2', 'e3']);
});

it('keeps sessions and clients apart', async () => {
  const first = fakeDb();
  const second = fakeDb();
  first.add('a1', 1000);
  first.add('b1', 1000, 'class-b');
  second.add('x1', 1000);
  expect(ids(await readEvents(first.db, scope))).toEqual(['a1']);
  expect(ids(await readEvents(first.db, { ...scope, classId: 'class-b' }))).toEqual(['b1']);
  expect(ids(await readEvents(second.db, scope))).toEqual(['x1']);
});

it('reloads the whole log after a minute', async () => {
  const { db, add, findMany } = fakeDb();
  add('e1', 1000);
  await readEvents(db, scope);
  (Date.now as jest.Mock).mockReturnValue(1_060_000);
  await readEvents(db, scope);
  expect(findMany.mock.calls[1][0].where.OR).toBeUndefined();
});

it('returns a copy the caller may change', async () => {
  const { db, add } = fakeDb();
  add('e1', 1000);
  (await readEvents(db, scope)).pop();
  expect(ids(await readEvents(db, scope))).toEqual(['e1']);
});

it('reads the database every time when the cache is off', async () => {
  delete process.env.CHECKHEN_EVENT_CACHE;
  const { db, add, findMany } = fakeDb();
  add('e1', 1000);
  await readEvents(db, scope);
  await readEvents(db, scope);
  expect(findMany.mock.calls.every(([query]) => query.where.OR === undefined)).toBe(true);
});

it('runs overlapping reads of one session one after another, each from the newest log', async () => {
  const { db, add, findMany } = fakeDb();
  add('e1', 1000);
  await readEvents(db, scope);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = findMany.getMockImplementation()!;
  findMany.mockImplementationOnce(async (query: any) => {
    await gate;
    return answer(query);
  });
  const first = readEvents(db, scope);
  add('e2', 2000);
  const second = readEvents(db, scope);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The first read's query is waiting; the second has not queried yet.
  expect(findMany).toHaveBeenCalledTimes(2);
  release();
  expect(ids(await first)).toEqual(['e1', 'e2']);
  expect(ids(await second)).toEqual(['e1', 'e2']);
  expect(findMany.mock.calls[2][0].where.OR[0].createdAt.gt).toEqual(new Date(2000));
});

it('keeps its event count right when another session evicts one that is being read', async () => {
  const { db, add, findMany } = fakeDb();
  for (const classId of ['class-a', 'class-b', 'class-c']) {
    for (let i = 0; i < 100_000; i += 1)
      add(`${classId}-${String(i).padStart(6, '0')}`, 1000 + i, classId);
  }
  await readEvents(db, scope);
  await readEvents(db, { ...scope, classId: 'class-b' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = findMany.getMockImplementation()!;
  findMany.mockImplementationOnce(async (query: any) => {
    await gate;
    return answer(query);
  });
  const pending = readEvents(db, scope);
  await readEvents(db, { ...scope, classId: 'class-c' });
  release();
  await pending;
  const counts = cachedEventCounts(db);
  expect(counts.counted).toBe(counts.held);
  expect(counts.held).toBeLessThanOrEqual(200_000);
});
