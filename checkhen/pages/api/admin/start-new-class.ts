import { getServerSession } from 'next-auth';

function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
  return null;
}
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

type ResponseData = {
  message: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: 'Unauthorized' });

  const adminEmails = process.env.ADMIN_EMAILS?.split(',')
    .map((e) => `${e.trim()}@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`) || [];
  if (!adminEmails.includes(session.user.email)) return res.status(403).json({ message: 'Forbidden: Admin only' });

  const courseId = req.query.courseId ?? req.body?.courseId;
  if (typeof courseId !== 'string' || !await prisma.course.findUnique({ where: { id: courseId } })) {
    return res.status(400).json({ message: 'Select a course' });
  }
  const { templateId, name: bodyName, duration: bodyDuration, color: bodyColor } = req.body;

  let name: string;
  let duration: number;
  let color: string | null = null;
  let resolvedTemplateId: string | null = null;

  if (templateId) {
    // Scheduled path — look up the template
    if (typeof templateId !== 'string')
      return res.status(400).json({ message: 'Invalid templateId' });

    const template = await prisma.classTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.courseId !== courseId) return res.status(404).json({ message: 'Template not found' });

    name = template.name;
    duration = template.duration;
    color = template.color;
    resolvedTemplateId = template.id;
  } else {
    // Ad hoc path
    if (!bodyName || typeof bodyName !== 'string' || bodyName.trim().length === 0 || bodyName.length > 200)
      return res.status(400).json({ message: 'Invalid class name' });
    if (!bodyDuration || typeof bodyDuration !== 'number' || bodyDuration <= 0 || bodyDuration > 480)
      return res.status(400).json({ message: 'Invalid duration (must be 1–480 minutes)' });

    name = bodyName.trim();
    duration = bodyDuration;
    // Optional color for ad hoc — normalize any valid hex variant
    if (bodyColor && typeof bodyColor === 'string') {
      const normalized = normalizeHex(bodyColor);
      if (normalized) color = normalized;
    }
  }

  const newClass = await prisma.class.create({
    data: {
      courseId,
      name,
      duration,
      color,
      templateId: resolvedTemplateId,
    },
  });

  res.status(200).json({ message: JSON.stringify(newClass) });
}
