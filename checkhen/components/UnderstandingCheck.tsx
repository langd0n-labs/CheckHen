import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { scopedFetch } from '@/lib/scoped-fetch';

/** Plain words for each understanding-check choice. */
export const CHOICE_LABELS: Record<string, string> = {
  got_it: 'Got it',
  another_example: 'Another example',
};

type InstructorCheck = {
  checkId: string;
  label: string | null;
  choices: string[];
  openedAt: string;
  closesAt: string | null;
  closedAt: string | null;
  open: boolean;
  present: number;
  answered: number;
  counts: Record<string, number>;
  answers: { userId: string; name: string; choice: string }[];
  number: number;
};

/** Whole seconds left on a timer, given the server's clock offset. */
export function secondsLeft(closesAt: string | null, offset: number): number | null {
  if (!closesAt) {
    return null;
  }
  return Math.max(0, Math.ceil((new Date(closesAt).getTime() - (Date.now() + offset)) / 1000));
}

export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The instructor's understanding check: open one, watch the answers arrive, close it.
 * `refreshSignal` changes when a socket says the check changed.
 */
export function UnderstandingCheck({
  refreshSignal = 0,
  compact = false,
}: {
  refreshSignal?: number;
  compact?: boolean;
}) {
  const [check, setCheck] = useState<InstructorCheck | null>(null);
  const [threshold, setThreshold] = useState(0.25);
  const [label, setLabel] = useState('');
  const [timer, setTimer] = useState<'3' | 'none'>('3');
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const offset = useRef(0);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const response = await scopedFetch('/api/admin/fetch-check').catch(() => null);
    if (!response?.ok) {
      return;
    }
    const data = await response.json();
    offset.current = new Date(data.now).getTime() - Date.now();
    setThreshold(data.threshold);
    setCheck(data.check);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal]);

  // While a check is open: the countdown ticks each second and the tally refreshes
  // every few seconds, so it stays current without a socket.
  const open = check?.open ?? false;
  useEffect(() => {
    const every = open ? 3000 : 15000;
    const poll = window.setInterval(refresh, every);
    const tick = open ? window.setInterval(() => setTick((value) => value + 1), 1000) : 0;
    return () => {
      window.clearInterval(poll);
      if (tick) {
        window.clearInterval(tick);
      }
    };
  }, [open, refresh]);

  const left = open && check ? secondsLeft(check.closesAt, offset.current) : null;
  useEffect(() => {
    if (left === 0) {
      refresh();
    }
  }, [left, refresh]);

  const post = async (path: string, body: Record<string, unknown>, failure: string) => {
    setBusy(true);
    try {
      const response = await scopedFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!response?.ok) {
        const data = await response?.json().catch(() => ({}));
        notifications.show({ message: data?.message || failure, color: 'red' });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    post(
      '/api/admin/open-check',
      { label: label.trim() || undefined, minutes: timer === '3' ? 3 : null },
      'Could not open the check'
    ).then(() => setLabel(''));
  const close = () =>
    check &&
    post('/api/admin/close-check', { checkId: check.checkId }, 'Could not close the check');

  const another = check?.counts.another_example ?? 0;
  const share = check?.answered ? another / check.answered : 0;
  const needsExample = !!check?.answered && share >= threshold;

  const results = check && (
    <Stack gap={6}>
      {check.choices.map((choice) => {
        const count = check.counts[choice] ?? 0;
        return (
          <div key={choice}>
            <Group justify="space-between" gap="xs">
              <Text size="sm">{CHOICE_LABELS[choice] ?? choice}</Text>
              <Text size="sm" fw={700}>
                {count}
              </Text>
            </Group>
            <Progress
              value={check.answered ? (count / check.answered) * 100 : 0}
              color={choice === 'another_example' ? 'warning' : 'successGreen'}
              aria-hidden
            />
          </div>
        );
      })}
      {needsExample && (
        <Alert color="yellow" p="xs">
          {Math.round(share * 100)}% asked for another example.
        </Alert>
      )}
      {check.answers.length > 0 && (
        <UnstyledButton onClick={() => setShowNames((value) => !value)} aria-expanded={showNames}>
          <Text size="sm" c="buBlue.7">
            {showNames ? 'Hide who answered' : 'Show who answered'}
          </Text>
        </UnstyledButton>
      )}
      {showNames &&
        check.choices.map((choice) => {
          const names = check.answers.filter((answer) => answer.choice === choice);
          return names.length ? (
            <Text size="sm" key={choice}>
              <Text span fw={600}>
                {CHOICE_LABELS[choice] ?? choice}:
              </Text>{' '}
              {names.map((answer) => answer.name).join(', ')}
            </Text>
          ) : null;
        })}
    </Stack>
  );

  if (check?.open) {
    return (
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>
            Check {check.number}
            {check.label ? `: ${check.label}` : ''}
          </Text>
          <Text fw={700} aria-live="off">
            {left === null ? 'No timer' : `${clock(left)} left`}
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          {check.answered} of {check.present} answered
        </Text>
        {results}
        <Button color="gray" variant="light" onClick={close} loading={busy} h={44}>
          Close check
        </Button>
      </Stack>
    );
  }

  if (compact) {
    // The phone screen: one tap opens a 3-minute check; the dashboard has the options.
    return (
      <Button variant="light" onClick={start} loading={busy} h={44}>
        Check understanding
      </Button>
    );
  }

  return (
    <Stack gap="xs">
      <Text fw={600}>Understanding check</Text>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <TextInput
          aria-label="Check label (optional)"
          placeholder="Label (optional)"
          value={label}
          maxLength={100}
          onChange={(event) => setLabel(event.currentTarget.value)}
          style={{ flex: '1 1 140px' }}
        />
        <SegmentedControl
          aria-label="Timer"
          value={timer}
          onChange={(value) => setTimer(value as '3' | 'none')}
          data={[
            { value: '3', label: '3 min' },
            { value: 'none', label: 'No timer' },
          ]}
        />
      </Group>
      <Button onClick={start} loading={busy} h={44}>
        Check understanding
      </Button>
      {check && (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            Last check{check.label ? ` (${check.label})` : ''}:{' '}
            {new Date(check.openedAt).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
            , {check.answered} answered
          </Text>
          {results}
        </Stack>
      )}
    </Stack>
  );
}
