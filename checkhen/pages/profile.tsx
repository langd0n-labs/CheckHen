import Link from 'next/link';
import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useDemoMode } from '@/lib/use-mode';
import { useEffect, useRef, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import {
  Anchor,
  Avatar,
  Box,
  Button,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { GraduationCap, ArrowLeft, Save, Camera } from 'lucide-react';

const PRONOUN_OPTIONS = ['she/her', 'he/him', 'they/them', 'Other'];
const BIO_LIMIT = 280;

export default function ProfilePage() {
  const narrow = useMediaQuery('(max-width: 26em)') ?? false;
  const { data: session, status } = useSession();
  const router = useRouter();
  const theme = useMantineTheme();

  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [foodAllergies, setFoodAllergies] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [namePronunciation, setNamePronunciation] = useState('');
  const [pronounsSelection, setPronounsSelection] = useState('');
  const [customPronouns, setCustomPronouns] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  // Demo personas are shared by every visitor, so their photos stay fixed.
  const demo = useDemoMode();
  const [backHref, setBackHref] = useState('/');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;

    fetch('/api/auth/is-admin')
      .then((r) => r.json())
      .then(({ isAdmin }) => {
        if (isAdmin) setBackHref('/admin/dashboard');
      });

    fetch('/api/student/get-profile')
      .then((r) => r.json())
      .then((data) => {
        setProfilePicture(data.profilePicture ?? null);
        setFoodAllergies(data.foodAllergies ?? '');
        setDisplayName(data.displayName ?? '');
        setNamePronunciation(data.namePronunciation ?? '');
        setBio(data.bio ?? '');

        const saved = data.pronouns ?? '';
        if (PRONOUN_OPTIONS.slice(0, 3).includes(saved)) {
          setPronounsSelection(saved);
        } else if (saved) {
          setPronounsSelection('Other');
          setCustomPronouns(saved);
        }
      })
      .catch(() => {
        notifications.show({ title: 'Error', message: 'Could not load profile', color: 'red' });
      });
  }, [status]);

  const effectivePronouns =
    pronounsSelection === 'Other' ? customPronouns : pronounsSelection;

  const handlePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const imageBase64 = reader.result as string;
      setUploadingPicture(true);
      const res = await fetch('/api/student/upload-profile-picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      setUploadingPicture(false);
      if (res.ok) {
        setProfilePicture(imageBase64);
        notifications.show({ title: 'Photo updated', message: 'Profile picture saved', color: 'green' });
      } else {
        const { message } = await res.json();
        notifications.show({ title: 'Upload failed', message: message ?? 'Could not save image', color: 'red' });
      }
    };
    reader.readAsDataURL(file);
    // reset so picking the same file again triggers onChange
    e.target.value = '';
  };

  const handleSave = async () => {
    if (bio.length > BIO_LIMIT) return;
    setSaving(true);
    const res = await fetch('/api/student/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        foodAllergies: foodAllergies || null,
        displayName: displayName || null,
        namePronunciation: namePronunciation || null,
        pronouns: effectivePronouns || null,
        bio: bio || null,
      }),
    });
    setSaving(false);

    if (res.ok) {
      notifications.show({ title: 'Saved', message: 'Profile updated successfully', color: 'green' });
    } else {
      notifications.show({ title: 'Error', message: 'Could not save profile', color: 'red' });
    }
  };

  if (status === 'loading') {
    return (
      <Box style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <Box
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${theme.colors.buBlue[0]} 0%, ${theme.colors.warmRed[0]} 100%)`,
        }}
      >
        <Card shadow="lg" padding="xl" radius="md" style={{ maxWidth: 400, width: '100%' }}>
          <Stack align="center" gap="md">
            <GraduationCap size={40} color={theme.colors.buBlue[5]} />
            <Title order={2}>Sign in required</Title>
            <Button onClick={() => signIn('google')} size="lg" fullWidth>
              Sign In with Google
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  const email = session?.user?.email ?? '';

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${theme.colors.buBlue[0]} 0%, ${theme.colors.warmRed[0]} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
      }}
    >
      <Card shadow="lg" padding="xl" radius="md" style={{ maxWidth: 520, width: '100%' }}>
        <Stack gap="lg">
          <Group justify="space-between">
            <div>
              <Title order={3}>My Profile</Title>
              <Anchor component={Link} href="/help/student#profile" size="sm">
                Who sees your profile
              </Anchor>
            </div>
            <Button
              variant="subtle"
              size="sm"
              leftSection={<ArrowLeft size={16} />}
              onClick={() => router.push(backHref)}
            >
              Back
            </Button>
          </Group>

          {/* Avatar */}
          <Group gap="md">
            <Tooltip label={demo ? 'Photos are fixed in the demo' : 'Change photo'} position="bottom">
              <Box
                style={{ position: 'relative', cursor: demo ? 'default' : 'pointer', display: 'inline-block' }}
                onClick={() => !demo && fileInputRef.current?.click()}
              >
                <Avatar src={profilePicture} size={80} radius="50%" opacity={uploadingPicture ? 0.5 : 1} />
                {!demo && <Box
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    background: 'rgba(0,0,0,0.55)',
                    borderRadius: '50%',
                    width: 26,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Camera size={14} color="white" />
                </Box>}
              </Box>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePictureChange}
            />
            <div>
              <Text fw={600}>{email.split('@')[0]}</Text>
              <Text size="sm" c="dimmed">{email}</Text>
            </div>
          </Group>

          {/* Display Name */}
          <TextInput
            label="Display Name"
            description="Your preferred name to show instructors (leave blank to use your email)"
            placeholder={email.split('@')[0]}
            value={displayName}
            maxLength={80}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
          />

          {/* Name Pronunciation */}
          <TextInput
            label="How to pronounce your name"
            placeholder="e.g. AL-ex"
            value={namePronunciation}
            maxLength={80}
            onChange={(e) => setNamePronunciation(e.currentTarget.value)}
          />

          {/* Pronouns */}
          <Stack gap="xs">
            <Text size="sm" fw={500}>Pronouns</Text>
            <SegmentedControl
              value={pronounsSelection}
              onChange={setPronounsSelection}
              data={PRONOUN_OPTIONS}
              fullWidth
              // Four choices do not fit side by side on a narrow phone.
              orientation={narrow ? 'vertical' : 'horizontal'}
            />
            {pronounsSelection === 'Other' && (
              <TextInput
                placeholder="Enter your pronouns"
                value={customPronouns}
                maxLength={40}
                onChange={(e) => setCustomPronouns(e.currentTarget.value)}
              />
            )}
          </Stack>

          {/* Bio */}
          <Stack gap={4}>
            <Textarea
              label="About me"
              description="Fun facts or what you're looking forward to learning"
              placeholder="I love hiking and I'm really excited to learn about..."
              value={bio}
              onChange={(e) => setBio(e.currentTarget.value)}
              autosize
              minRows={3}
              maxRows={6}
              error={bio.length > BIO_LIMIT ? `${bio.length - BIO_LIMIT} characters over limit` : undefined}
            />
            <Text
              size="xs"
              c={bio.length > BIO_LIMIT ? 'red' : bio.length > BIO_LIMIT * 0.9 ? 'orange' : 'dimmed'}
              ta="right"
            >
              {bio.length} / {BIO_LIMIT}
            </Text>
          </Stack>

          {/* Food Allergies */}
          <Textarea
            label="Food Allergies"
            description="Let your instructor know about any food allergies (e.g. peanuts, dairy)"
            placeholder="None"
            value={foodAllergies}
            maxLength={200}
            onChange={(e) => setFoodAllergies(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
          />

          <Button
            leftSection={<Save size={16} />}
            onClick={handleSave}
            loading={saving}
            disabled={bio.length > BIO_LIMIT}
          >
            Save Profile
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
