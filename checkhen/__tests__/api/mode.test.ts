import { createMocks } from 'node-mocks-http';
import { databaseFull } from '@/lib/demo-guard';
import modeRoute from '@/pages/api/mode';

jest.mock('@/lib/demo-guard', () => ({ databaseFull: jest.fn().mockResolvedValue(false) }));

afterEach(() => {
  delete process.env.CHECKHEN_MODE;
  delete process.env.CHECKHEN_DEMO;
});

const read = async () => {
  const { req, res } = createMocks({ method: 'GET' });
  await modeRoute(req as any, res as any);
  return res._getJSONData();
};

it('reports classroom mode unless hosted mode is set, and the demo flag', async () => {
  expect(await read()).toEqual({ mode: 'classroom', demo: false });
  process.env.CHECKHEN_MODE = 'hosted';
  process.env.CHECKHEN_DEMO = '1';
  expect(await read()).toEqual({ mode: 'hosted', demo: true, full: false });
  (databaseFull as jest.Mock).mockResolvedValueOnce(true);
  expect(await read()).toEqual({ mode: 'hosted', demo: true, full: true });
});
