import type { NextApiRequest, NextApiResponse } from 'next';

/** Cookie-authenticated writes must come from the configured application origin. */
export function guardWriteOrigin(req: NextApiRequest, res: NextApiResponse): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) return true;

  let expected: string;
  try {
    const value = process.env.NEXTAUTH_URL || '';
    if (!/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) {
      throw new Error('Invalid application URL');
    }
    const configured = new URL(value);
    if (!['https:', 'http:'].includes(configured.protocol) || configured.username || configured.password) {
      throw new Error('Invalid application URL');
    }
    expected = configured.origin;
  } catch {
    res.status(403).json({ message: 'Invalid write origin' });
    return false;
  }

  // Node can join duplicate headers. Check the raw list as well as the parsed value.
  const count = (req.rawHeaders || []).filter((_, index) =>
    index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'origin').length;
  if (count > 1 || typeof req.headers.origin !== 'string' || req.headers.origin !== expected) {
    res.status(403).json({ message: 'Invalid write origin' });
    return false;
  }
  const mediaType = req.headers['content-type'];
  if (typeof mediaType !== 'string' ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:[\w-]+|"[\w-]+"))?\s*$/i.test(mediaType)) {
    res.status(415).json({ message: 'Content-Type must be application/json' });
    return false;
  }
  return true;
}
