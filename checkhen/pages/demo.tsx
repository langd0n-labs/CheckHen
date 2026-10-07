import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Avatar, Box, Card, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { selectScope } from '@/lib/scoped-fetch';

type Persona = {
  email: string;
  name: string;
  note: string;
  photo: string;
  role: 'instructor' | 'student';
};
type DemoInfo = { courseId: string; liveClassId: string | null; personas: Persona[] };

/** Demo mode sign-in: choose who to be. Everyone here is fictional. */
export default function DemoSignIn() {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/demo')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Not a demo deployment'))
      )
      .then(setInfo)
      .catch(() => setFailed(true));
  }, []);

  const choose = (persona: Persona) => {
    if (!info) {
      return;
    }
    // Open the demo course's live session as whoever was chosen.
    selectScope({ courseId: info.courseId, classId: info.liveClassId ?? undefined });
    signIn('demo', {
      email: persona.email,
      callbackUrl: persona.role === 'instructor' ? '/admin/dashboard' : '/',
    });
  };

  if (failed) {
    return <Text p="md">This is not a demo deployment, so there is no one to sign in as.</Text>;
  }
  if (!info) {
    return (
      <Text p="md" c="dimmed">
        Loading the demo…
      </Text>
    );
  }
  const instructor = info.personas.filter((persona) => persona.role === 'instructor');
  const students = info.personas.filter((persona) => persona.role === 'student');
  const card = (persona: Persona) => (
    <UnstyledButton
      key={persona.email}
      onClick={() => choose(persona)}
      aria-label={`Sign in as ${persona.name}`}
    >
      <Card withBorder padding="sm">
        <Stack align="center" gap={4}>
          <Avatar src={persona.photo} alt="" size={72} radius={72} />
          <Text fw={700} ta="center">
            {persona.name}
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            {persona.note}
          </Text>
        </Stack>
      </Card>
    </UnstyledButton>
  );
  return (
    <Box component="main" px="md" py="xl" maw={960} mx="auto">
      <Title order={1}>Try the CheckHen demo</Title>
      <Text size="lg" mt="xs" mb="lg">
        Choose who to be. The class, its students, and everything they did are made up; the
        instructor can reset the demo to its starting data.
      </Text>
      <Title order={2} fz={20} mb="sm">
        Instructor
      </Title>
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="xl">
        {instructor.map(card)}
      </SimpleGrid>
      <Title order={2} fz={20} mb="sm">
        Students
      </Title>
      <SimpleGrid cols={{ base: 2, sm: 4, md: 5 }}>{students.map(card)}</SimpleGrid>
    </Box>
  );
}
