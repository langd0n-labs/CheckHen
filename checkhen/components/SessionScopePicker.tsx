import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Anchor, Button, Group, Select, Text, TextInput } from '@mantine/core';
import { scopedFetch, selectScope, selectedScope } from '@/lib/scoped-fetch';
import { useDemoMode } from '@/lib/use-mode';

type Course = { id: string; name: string; role?: 'instructor' | 'student' };
type ClassSession = { id: string; name: string; active: boolean };

export function SessionScopePicker() {
  const { status, data: session } = useSession();
  const admin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin === true;
  // The demo refuses new courses, so it offers none.
  const demo = useDemoMode();
  const instructorPage =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  const [courses, setCourses] = useState<Course[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState('');
  useEffect(() => {
    if (status !== 'authenticated') return;
    const scope = selectedScope();
    setCourseId(scope.courseId ?? null);
    setClassId(scope.classId ?? null);
    scopedFetch('/api/courses').then(r => r.ok ? r.json() : { courses: [] })
      .then(data => { setCourses(data.courses); setCanCreate(data.canCreate === true); });
  }, [status]);
  useEffect(() => {
    if (!courseId) { setSessions([]); return; }
    scopedFetch('/api/sessions?courseId=' + encodeURIComponent(courseId))
      .then(r => r.ok ? r.json() : { sessions: [] })
      .then(data => setSessions(data.sessions));
  }, [courseId]);
  if (status !== 'authenticated') return null;
  // Someone can instruct one course and take another: instructor pages list the courses
  // they instruct, student pages the courses they take, and a link leads to the other.
  const instructs = courses.filter(course => course.role !== 'student');
  const takes = courses.filter(course => course.role === 'student');
  const listed = instructorPage ? instructs : takes.length ? takes : courses;
  const chooseCourse = (value: string | null) => {
    selectScope({ courseId: value ?? undefined });
    setCourseId(value);
    setClassId(null);
    window.location.reload();
  };
  const chooseSession = (value: string | null) => {
    selectScope({ courseId: courseId ?? undefined, classId: value ?? undefined });
    setClassId(value);
    window.location.reload();
  };
  const addCourse = async () => {
    const name = courseName.trim();
    if (!name) return;
    const result = await scopedFetch('/api/courses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!result.ok) return;
    const { course } = await result.json();
    chooseCourse(course.id);
  };
  return (
    <Group component="nav" aria-label="Course and class session" p="xs" gap="xs" wrap="wrap">
      <Select aria-label="Course" placeholder="Select course" data={listed.map(course => ({ value: course.id, label: course.name }))}
        value={courseId} onChange={chooseCourse} searchable w={{ base: '100%', xs: 220 }} />
      <Select aria-label="Class session" placeholder="Select class session"
        data={sessions.filter(item => admin || item.active).map(item => ({ value: item.id, label: item.name }))}
        value={classId} onChange={chooseSession} searchable w={{ base: '100%', xs: 220 }} disabled={!courseId} />
      {canCreate && admin && !demo && instructorPage && <Group gap="xs">
        <TextInput aria-label="New course name" placeholder="New course" value={courseName}
          onChange={event => setCourseName(event.currentTarget.value)} w={220} />
        <Button size="xs" onClick={addCourse}>Create course</Button>
      </Group>}
      {instructorPage && takes.length > 0 &&
        <Anchor component={Link} href="/join" size="sm">Courses you take</Anchor>}
      {!instructorPage && takes.length > 0 && instructs.length > 0 &&
        <Anchor component={Link} href="/admin/dashboard" size="sm">Courses you instruct</Anchor>}
      {!courseId && <Text size="sm">Select a course to continue.</Text>}
    </Group>
  );
}
