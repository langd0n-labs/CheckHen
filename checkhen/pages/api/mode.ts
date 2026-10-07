import type { NextApiRequest, NextApiResponse } from 'next';
import { checkhenMode } from '@/lib/mode';

/** Public: the pages adapt to the mode before anyone signs in. */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }
  return res.json({ mode: checkhenMode() });
}
