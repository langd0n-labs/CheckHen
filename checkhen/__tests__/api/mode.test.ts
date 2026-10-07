import { createMocks } from 'node-mocks-http';
import modeRoute from '@/pages/api/mode';

afterEach(() => {
  delete process.env.CHECKHEN_MODE;
  delete process.env.CHECKHEN_DEMO;
});

const read = () => {
  const { req, res } = createMocks({ method: 'GET' });
  modeRoute(req as any, res as any);
  return res._getJSONData();
};

it('reports classroom mode unless hosted mode is set, and the demo flag', () => {
  expect(read()).toEqual({ mode: 'classroom', demo: false });
  process.env.CHECKHEN_MODE = 'hosted';
  process.env.CHECKHEN_DEMO = '1';
  expect(read()).toEqual({ mode: 'hosted', demo: true });
});
