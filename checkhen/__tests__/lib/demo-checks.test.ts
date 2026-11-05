import { simulateCheckAnswers } from '@/lib/demo-checks';
import { readState } from '@/lib/event-store';

jest.mock('@/lib/checks', () => ({ answerCheck: jest.fn() }));
jest.mock('@/lib/demo-guard', () => ({ databaseFull: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/event-store', () => ({ readState: jest.fn() }));

const scope = { courseId: 'course', classId: 'session' };

afterEach(() => { jest.restoreAllMocks(); });

it.each([
  ['a Node timer object', () => ({ unref: jest.fn() })],
  ['a browser timer number', () => 1],
])('schedules one answer for each present student when setTimeout returns %s', async (_, timer) => {
  (readState as jest.Mock).mockResolvedValue({
    attendance: [
      { userId: 'a', isPresent: true },
      { userId: 'b', isPresent: true },
      { userId: 'c', isPresent: false },
      { userId: 'd', isPresent: true },
    ],
  });
  const schedule = jest.spyOn(global, 'setTimeout').mockImplementation(timer as never);
  await simulateCheckAnswers({} as never, scope, 'check', () => 0);
  expect(schedule).toHaveBeenCalledTimes(3);
});
