import type { NextApiRequest, NextApiResponse } from 'next';
import { requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';

type ClassTemplateRecord = {
  id: string;
  name: string;
  color: string;
  duration: number;
  daysOfWeek: number[];
  startTime: string;
  tz: string;
  createdAt: string;
};

type ResponseData = ClassTemplateRecord[] | ClassTemplateRecord | { message: string };

function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // #rgb → #rrggbb
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  // #rrggbb
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  // #rrggbbaa — strip alpha
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (!(await requireIdentity(req, res, true))) return;
  const courseId = req.query.courseId ?? req.body?.courseId;
  if (typeof courseId !== 'string' || !await prisma.course.findUnique({ where: { id: courseId } }))
    return res.status(400).json({ message: 'Select a course' });

  // GET — list all templates
  if (req.method === 'GET') {
    const templates = await prisma.classTemplate.findMany({
      where: { courseId },
      orderBy: { name: 'asc' },
    });
    return res.status(200).json(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        duration: t.duration,
        daysOfWeek: t.daysOfWeek,
        startTime: t.startTime,
        tz: t.tz,
        createdAt: t.createdAt.toISOString(),
      }))
    );
  }

  // POST — create template
  if (req.method === 'POST') {
    const { name, color, duration, daysOfWeek, startTime, tz } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200)
      return res.status(400).json({ message: 'Invalid name' });
    // Accept #rgb, #rrggbb, #rrggbbaa — normalize to #rrggbb
    const normalizedColor = normalizeHex(color);
    if (!normalizedColor)
      return res.status(400).json({ message: 'Invalid color (must be hex, e.g. #ff0000)' });
    if (!duration || typeof duration !== 'number' || duration <= 0 || duration > 480)
      return res.status(400).json({ message: 'Invalid duration (1–480 minutes)' });
    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.some((d) => typeof d !== 'number' || d < 0 || d > 6))
      return res.status(400).json({ message: 'Invalid daysOfWeek (array of 0–6)' });
    if (!startTime || typeof startTime !== 'string' || !/^\d{2}:\d{2}$/.test(startTime))
      return res.status(400).json({ message: 'Invalid startTime (HH:MM)' });

    const template = await prisma.classTemplate.create({
      data: {
        courseId,
        name: name.trim(),
        color: normalizedColor,
        duration,
        daysOfWeek,
        startTime,
        tz: typeof tz === 'string' ? tz : 'America/New_York',
      },
    });

    return res.status(201).json({
      id: template.id,
      name: template.name,
      color: template.color,
      duration: template.duration,
      daysOfWeek: template.daysOfWeek,
      startTime: template.startTime,
      tz: template.tz,
      createdAt: template.createdAt.toISOString(),
    });
  }

  // DELETE — remove template by ?id=
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id || typeof id !== 'string')
      return res.status(400).json({ message: 'Missing id query param' });

    const target = await prisma.classTemplate.findFirst({ where: { id, courseId } });
    if (!target) return res.status(404).json({ message: 'Template not found' });
    await prisma.classTemplate.delete({ where: { id: target.id } });
    return res.status(200).json({ message: 'Deleted' });
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
}
