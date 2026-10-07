import { createMocks } from 'node-mocks-http';
import modeRoute from '@/pages/api/mode';

afterEach(() => {
  delete process.env.CHECKHEN_MODE;
});

it('reports classroom mode unless hosted mode is set', () => {
  const { req, res } = createMocks({ method: 'GET' });
  modeRoute(req as any, res as any);
  expect(res._getJSONData()).toEqual({ mode: 'classroom' });
  process.env.CHECKHEN_MODE = 'hosted';
  const hosted = createMocks({ method: 'GET' });
  modeRoute(hosted.req as any, hosted.res as any);
  expect(hosted.res._getJSONData()).toEqual({ mode: 'hosted' });
});
