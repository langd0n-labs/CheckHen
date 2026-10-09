import type { NextApiRequest, NextApiResponse } from 'next';
import { isDemo } from '@/lib/demo';
import { databaseFull } from '@/lib/demo-guard';
import { checkhenMode } from '@/lib/mode';

/** Public: the pages adapt to the mode before anyone signs in. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }
  const demo = isDemo();
  // A full demo takes no changes; every page says so instead of failing quietly.
  return res.json({ mode: checkhenMode(), demo, ...(demo ? { full: await databaseFull() } : {}) });
}
