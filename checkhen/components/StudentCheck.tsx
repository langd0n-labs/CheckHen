import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { scopedFetch } from '@/lib/scoped-fetch';
import { CHOICE_LABELS, clock, secondsLeft } from './UnderstandingCheck';

type OpenCheck = {
  checkId: string;
  label: string | null;
  choices: string[];
  closesAt: string | null;
  answer: string | null;
};

/**
 * The student's understanding check. It shows only while a check is open; otherwise
 * the page stays as it was. `refreshSignal` changes when a socket says a check opened
 * or closed.
 */
export function StudentCheck({
  refreshSignal = 0,
  enabled,
}: {
  refreshSignal?: number;
  enabled: boolean;
}) {
  const [check, setCheck] = useState<OpenCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const offset = useRef(0);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const response = await scopedFetch('/api/student/fetch-check').catch(() => null);
    if (!response?.ok) {
      return;
    }
    const data = await response.json();
    offset.current = new Date(data.now).getTime() - Date.now();
    setCheck(data.check);
  }, []);

  // A slow poll backs up the socket, which can miss an event while reconnecting.
  useEffect(() => {
    if (!enabled) {
      setCheck(null);
      return;
    }
    refresh();
    const poll = window.setInterval(refresh, 15000);
    return () => window.clearInterval(poll);
  }, [enabled, refresh, refreshSignal]);

  useEffect(() => {
    if (!check?.closesAt) {
      return;
    }
    const tick = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [check?.closesAt]);

  const left = check ? secondsLeft(check.closesAt, offset.current) : null;
  useEffect(() => {
    if (left === 0) {
      setCheck(null);
    }
  }, [left]);

  if (!check) {
    return null;
  }

  const answer = async (choice: string) => {
    setBusy(true);
    try {
      const response = await scopedFetch('/api/student/answer-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: check.checkId, choice }),
      }).catch(() => null);
      if (response?.ok) {
        setCheck({ ...check, answer: choice });
      } else {
        const data = await response?.json().catch(() => ({}));
        notifications.show({
          message: data?.message || 'Could not send your answer. Try again.',
          color: 'red',
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" withBorder role="region" aria-label="Understanding check">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>Did that land?</Text>
          {left !== null && (
            <Text fw={700} aria-live="off">
              {clock(left)}
            </Text>
          )}
        </Group>
        {check.label && (
          <Text size="sm" c="dimmed">
            {check.label}
          </Text>
        )}
        <Group grow gap="xs">
          {check.choices.map((choice) => (
            <Button
              key={choice}
              h={48}
              variant={check.answer === choice ? 'filled' : 'light'}
              color={choice === 'another_example' ? 'warning' : 'successGreen'}
              aria-pressed={check.answer === choice}
              disabled={busy}
              onClick={() => answer(choice)}
            >
              {CHOICE_LABELS[choice] ?? choice}
            </Button>
          ))}
        </Group>
        <Text size="sm" c="dimmed" aria-live="polite">
          {check.answer
            ? 'Sent to your instructor. You can change it until the check closes.'
            : 'Your instructor sees your answer.'}
        </Text>
      </Stack>
    </Card>
  );
}
