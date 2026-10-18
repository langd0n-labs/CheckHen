import { useCallback, useEffect, useState } from 'react';
import { Button, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';

type Member = { email: string; name: string | null; role: string };

const ROLE_LABELS: Record<string, string> = { instructor: 'Instructor', ta: 'TA' };

/** The course's instructors and TAs. A deployment instructor can add and remove them. */
export function CourseStaff({ courseId }: { courseId: string }) {
  const [staff, setStaff] = useState<Member[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('instructor');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/admin/course-staff?courseId=${encodeURIComponent(courseId)}`
    );
    if (!response.ok) return;
    const result = await response.json();
    setStaff(result.staff);
    setCanManage(result.canManage);
  }, [courseId]);
  useEffect(() => {
    void load();
  }, [load]);

  const change = async (method: 'POST' | 'DELETE', body: Record<string, string>) => {
    setBusy(true);
    const response = await fetch('/api/admin/course-staff', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, ...body }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    notifications.show(
      response.ok
        ? { message: result.message }
        : {
            title: 'Error',
            message: result.message ?? 'Could not change course staff',
            color: 'red',
          }
    );
    if (response.ok) {
      setEmail('');
      void load();
    }
  };

  if (!staff) return <Text c="dimmed">Loading course staff…</Text>;
  return (
    <Stack gap="md">
      <Text>
        Course staff can run this course&apos;s classes and see its records. They cannot see other
        courses.
      </Text>
      {staff.length === 0 ? (
        <Text c="dimmed">No course staff yet.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              {canManage && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {staff.map((member) => (
              <Table.Tr key={member.email}>
                <Table.Td>{member.name ?? '—'}</Table.Td>
                <Table.Td>{member.email}</Table.Td>
                <Table.Td>{ROLE_LABELS[member.role] ?? member.role}</Table.Td>
                {canManage && (
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      disabled={busy}
                      onClick={() => change('DELETE', { email: member.email })}
                    >
                      Remove
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {canManage && (
        <Group align="flex-end">
          <TextInput
            label="BU username or email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <Select
            label="Role"
            data={[
              { value: 'instructor', label: 'Instructor' },
              { value: 'ta', label: 'TA' },
            ]}
            value={role}
            onChange={(value) => setRole(value ?? 'instructor')}
            allowDeselect={false}
          />
          <Button
            loading={busy}
            disabled={!email.trim()}
            onClick={() => change('POST', { email, role })}
          >
            Add to staff
          </Button>
        </Group>
      )}
    </Stack>
  );
}
