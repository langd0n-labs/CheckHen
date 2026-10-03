import { selectScope, selectedScope } from '@/lib/scoped-fetch';
import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Group,
  Modal,
  MultiSelect,
  Notification,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCheck, IconX } from '@tabler/icons-react';

type ClassTemplate = {
  id: string;
  name: string;
  color: string;
  duration: number;
  daysOfWeek: number[];
  startTime: string;
  tz: string;
};

const DAY_OPTIONS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
];

const SWATCHES = [
  '#e03131', // red
  '#e67700', // orange
  '#2f9e44', // green
  '#1971c2', // blue
  '#7048e8', // purple
  '#c2255c', // pink
  '#0c8599', // teal
];

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>{label}</Text>
      <Group gap={6}>
        {SWATCHES.map((swatch) => (
          <Box
            key={swatch}
            onClick={() => onChange(swatch)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              backgroundColor: swatch,
              cursor: 'pointer',
              border: value === swatch ? '3px solid #000' : '2px solid transparent',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          />
        ))}
      </Group>
      <TextInput
        placeholder="#0066ff"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
        leftSection={
          /^#[0-9a-fA-F]{6}$/.test(value) ? (
            <Box style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: value }} />
          ) : null
        }
        styles={{ input: { fontFamily: 'monospace' } }}
      />
    </Stack>
  );
}

export default function ClassSessionManager({
  currentClass,
  setCurrentClass,
  currentClassId,
  setCurrentClassId,
  onClassColor,
  onOpenModal,
  onReady,
}: {
  currentClass: string;
  setCurrentClass: (value: string) => void;
  currentClassId: string;
  setCurrentClassId: (value: string) => void;
  onClassColor?: (color: string | null) => void;
  onOpenModal?: (openFn: () => void) => void;
  onReady?: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);

  const [mode, setMode] = useState<'adhoc' | 'scheduled'>('adhoc');

  // Ad hoc fields
  const [adhocName, setAdhocName] = useState('');
  const [adhocDuration, setAdhocDuration] = useState<string | number>('');
  const [adhocColor, setAdhocColor] = useState('');

  // Scheduled — pick existing template
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Scheduled — create new template sub-form
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplColor, setTplColor] = useState('#0066ff');
  const [tplDuration, setTplDuration] = useState<string | number>('');
  const [tplDays, setTplDays] = useState<string[]>([]);
  const [tplStartTime, setTplStartTime] = useState('');

  const [notification, setNotification] = useState('');
  const [notificationIsError, setNotificationIsError] = useState(false);

  const xIcon = <IconX size={20} />;
  const checkIcon = <IconCheck size={20} />;

  const displayNotification = (message: string, isError = false) => {
    setNotificationIsError(isError);
    setNotification(message);
  };

  const fetchTemplates = async () => {
    const res = await fetch('/api/admin/class-templates');
    if (res.ok) {
      const data: ClassTemplate[] = await res.json();
      setTemplates(data);
    }
  };

  const fetchCurrentClass = async () => {
    const response = await fetch('/api/fetch-latest-class');
    if (!response.ok) {
      setCurrentClass('');
      onClassColor?.(null);
      return;
    }
    const data = await response.json();
    const jsonData = JSON.parse(data.message);
    const date = new Date(jsonData.createdAt);
    const endDate = new Date(date.getTime() + jsonData.duration * 60000);

    if (endDate < new Date()) {
      setCurrentClass('');
      onClassColor?.(null);
      return;
    }

    if (currentClassId === jsonData.id) return;

    selectScope({ ...selectedScope(), classId: jsonData.id });
    setCurrentClassId(jsonData.id);
    onClassColor?.(jsonData.color ?? null);
    const formattedDate = date.toLocaleString();
    setCurrentClass(`${jsonData.name} - ${formattedDate}`);
  };

  useEffect(() => {
    fetchCurrentClass().finally(() => onReady?.());
    fetchTemplates();
    const interval = setInterval(fetchCurrentClass, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleOpen = () => {
    // Reset state each time modal opens
    setMode('adhoc');
    setAdhocName('');
    setAdhocDuration('');
    setAdhocColor('');
    setSelectedTemplateId(null);
    setShowNewTemplate(false);
    setTplName('');
    setTplColor('#0066ff');
    setTplDuration('');
    setTplDays([]);
    setTplStartTime('');
    setNotification('');
    fetchTemplates();
    open();
  };

  // Register handleOpen once; use a ref so the callback is always current
  // without re-running the effect on every render
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;

  useEffect(() => {
    if (onOpenModal) onOpenModal(() => handleOpenRef.current());
  }, [onOpenModal]);

  const applyNewClass = (jsonData: { id: string; name: string; createdAt: string; color?: string | null }) => {
    const date = new Date(jsonData.createdAt);
    selectScope({ ...selectedScope(), classId: jsonData.id });
    setCurrentClassId(jsonData.id);
    onClassColor?.(jsonData.color ?? null);
    setCurrentClass(`${jsonData.name} - ${date.toLocaleString()}`);
    close();
  };

  const startAdHoc = async () => {
    if (!adhocName.trim()) {
      displayNotification('Please enter a class name', true);
      return;
    }
    if (!adhocDuration || Number(adhocDuration) <= 0) {
      displayNotification('Please enter a valid class duration', true);
      return;
    }
    const body: Record<string, unknown> = {
      name: adhocName.trim(),
      duration: Number(adhocDuration),
    };
    if (adhocColor && /^#[0-9a-fA-F]{6}$/.test(adhocColor)) {
      body.color = adhocColor;
    }
    const res = await fetch('/api/admin/start-new-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      displayNotification('Error starting class', true);
      return;
    }
    const data = await res.json();
    applyNewClass(JSON.parse(data.message));
  };

  const startScheduled = async () => {
    if (!selectedTemplateId) {
      displayNotification('Please select a class', true);
      return;
    }
    const res = await fetch('/api/admin/start-new-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedTemplateId }),
    });
    if (!res.ok) {
      displayNotification('Error starting class', true);
      return;
    }
    const data = await res.json();
    applyNewClass(JSON.parse(data.message));
  };

  const createTemplate = async () => {
    if (!tplName.trim()) { displayNotification('Template name required', true); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(tplColor)) { displayNotification('Pick a valid color', true); return; }
    if (!tplDuration || Number(tplDuration) <= 0) { displayNotification('Duration required', true); return; }
    if (tplDays.length === 0) { displayNotification('Select at least one day', true); return; }
    if (!tplStartTime) { displayNotification('Start time required', true); return; }

    const res = await fetch('/api/admin/class-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tplName.trim(),
        color: tplColor,
        duration: Number(tplDuration),
        daysOfWeek: tplDays.map(Number),
        startTime: tplStartTime,
      }),
    });
    if (!res.ok) {
      displayNotification('Error creating template', true);
      return;
    }
    const created: ClassTemplate = await res.json();
    setTemplates((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedTemplateId(created.id);
    setShowNewTemplate(false);
    displayNotification('');
  };

  const endClassEarly = async () => {
    const response = await fetch('/api/admin/end-class-early', { method: 'POST' });
    if (!response.ok) {
      displayNotification('Error ending class', true);
      return;
    }
    setCurrentClass('');
    setCurrentClassId('');
    onClassColor?.(null);
  };

  const templateOptions = templates.map((t) => ({
    value: t.id,
    label: t.name,
  }));

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <>
      {currentClass && (
        <Stack gap={2} align="center" mb="xs">
          <Title order={5} td="underline">Current Class Session</Title>
          <Text size="sm" c="dimmed" ta="center">{currentClass}</Text>
        </Stack>
      )}

      <Modal opened={opened} onClose={close} title="Start New Session" centered size="md">
        <Stack gap="sm">
          {notification && (
            <Notification
              icon={notificationIsError ? xIcon : checkIcon}
              color={notificationIsError ? 'red' : 'green'}
              title={notificationIsError ? 'Error' : 'Success'}
              withCloseButton={false}
              withBorder={false}
              style={{ boxShadow: 'none' }}
            >
              {notification}
            </Notification>
          )}

          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(v) => { setMode(v as 'adhoc' | 'scheduled'); setNotification(''); }}
            data={[
              { label: 'Ad Hoc', value: 'adhoc' },
              { label: 'Scheduled', value: 'scheduled' },
            ]}
          />

          {mode === 'adhoc' && (
            <Stack gap="sm">
              <TextInput
                label="Class name"
                placeholder="e.g. Office Hours"
                value={adhocName}
                onChange={(e) => setAdhocName(e.currentTarget.value)}
              />
              <NumberInput
                label="Duration (minutes)"
                placeholder="60"
                value={adhocDuration}
                onChange={setAdhocDuration}
                min={1}
                max={480}
              />
              <ColorPicker
                label="Color accent (optional)"
                value={adhocColor}
                onChange={setAdhocColor}
              />
              <Button onClick={startAdHoc} color="successGreen">Start</Button>
            </Stack>
          )}

          {mode === 'scheduled' && (
            <Stack gap="sm">
              {templates.length > 0 && !showNewTemplate ? (
                <>
                  <Select
                    label="Select a class"
                    placeholder="Choose a scheduled class"
                    data={templateOptions}
                    value={selectedTemplateId}
                    onChange={setSelectedTemplateId}
                  />
                  {selectedTemplate && (
                    <Group gap="xs">
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          backgroundColor: selectedTemplate.color,
                          flexShrink: 0,
                        }}
                      />
                      <Text size="sm" c="dimmed">
                        {selectedTemplate.duration} min ·{' '}
                        {selectedTemplate.daysOfWeek
                          .map((d) => DAY_OPTIONS[d]?.label)
                          .join(', ')}{' '}
                        @ {selectedTemplate.startTime}
                      </Text>
                    </Group>
                  )}
                  <Group justify="space-between">
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => setShowNewTemplate(true)}
                    >
                      + New scheduled class
                    </Button>
                    <Button onClick={startScheduled} color="successGreen">Start</Button>
                  </Group>
                </>
              ) : (
                <>
                  {templates.length === 0 && !showNewTemplate && (
                    <Text size="sm" c="dimmed">No scheduled classes yet.</Text>
                  )}
                  <TextInput
                    label="Class name"
                    placeholder="e.g. CS101"
                    value={tplName}
                    onChange={(e) => setTplName(e.currentTarget.value)}
                  />
                  <ColorPicker
                    label="Color tag"
                    value={tplColor}
                    onChange={setTplColor}
                  />
                  <NumberInput
                    label="Duration (minutes)"
                    placeholder="75"
                    value={tplDuration}
                    onChange={setTplDuration}
                    min={1}
                    max={480}
                  />
                  <MultiSelect
                    label="Days of week"
                    data={DAY_OPTIONS}
                    value={tplDays}
                    onChange={setTplDays}
                    placeholder="Select days"
                  />
                  <TextInput
                    label="Start time (HH:MM, 24h)"
                    placeholder="09:00"
                    value={tplStartTime}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTplStartTime(e.currentTarget.value)}
                    pattern="^\d{2}:\d{2}$"
                  />
                  <Group justify="space-between">
                    {templates.length > 0 && (
                      <Button variant="subtle" size="xs" onClick={() => setShowNewTemplate(false)}>
                        Back
                      </Button>
                    )}
                    <Button onClick={createTemplate} color="buBlue" ml="auto">Save Schedule</Button>
                  </Group>
                </>
              )}
            </Stack>
          )}
        </Stack>
      </Modal>

      <Group justify="center" pt="sm" gap="sm">
        <Button onClick={handleOpen} color="successGreen" disabled={!!currentClass}>
          Start New Class
        </Button>
        <Button onClick={fetchCurrentClass} variant="light">Refresh</Button>
        <Button onClick={endClassEarly} disabled={!currentClass} color="red">End Class</Button>
      </Group>
    </>
  );
}
