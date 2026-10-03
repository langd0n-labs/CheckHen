import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';

type StudentProfile = {
  email: string;
  profilePicture: string | null;
  displayName: string | null;
  namePronunciation: string | null;
  pronouns: string | null;
  bio: string | null;
  foodAllergies: string | null;
};

type Props = {
  email: string | null;
  onClose: () => void;
};

export function StudentProfileModal({ email, onClose }: Props) {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      setProfile(null);
      return;
    }
    setLoading(true);
    fetch(`/api/admin/get-student-profile?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .finally(() => setLoading(false));
  }, [email]);

  const displayName = profile?.displayName || profile?.email.split('@')[0] || '';

  return (
    <Modal
      opened={!!email}
      onClose={onClose}
      title="Student Profile"
      centered
      size="sm"
    >
      {loading && (
        <Group justify="center" py="xl">
          <Loader size="md" />
        </Group>
      )}

      {!loading && profile && (
        <Stack gap="md">
          <Group gap="md" align="flex-start">
            <Avatar src={profile.profilePicture} size={160} radius="50%" />
            <Stack gap={4}>
              <Title order={4}>{displayName}</Title>
              <Text size="sm" c="dimmed">{profile.email}</Text>
              {profile.pronouns && (
                <Badge color="violet" variant="light" size="sm">{profile.pronouns}</Badge>
              )}
            </Stack>
          </Group>

          {profile.namePronunciation && (
            <Stack gap={2}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Name Pronunciation</Text>
              <Text size="sm">{profile.namePronunciation}</Text>
            </Stack>
          )}

          {profile.bio && (
            <Stack gap={2}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">About</Text>
              <Text size="sm">{profile.bio}</Text>
            </Stack>
          )}

          {profile.foodAllergies && (
            <Stack gap={2}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Food Allergies</Text>
              <Badge color="orange" variant="light" size="sm">{profile.foodAllergies}</Badge>
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}
