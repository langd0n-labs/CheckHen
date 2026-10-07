import { Text } from '@mantine/core';
import { HelpLayout, HelpList as List } from '@/components/HelpLayout';

/** Help for what the room sees: the projection window and the Slidev chat component. */
export default function ProjectionHelp() {
  return (
    <HelpLayout
      title="What the room sees"
      intro="Two views show the class chat to the room: the projection window and the chat component inside a Slidev deck."
      back={{ href: '/admin/dashboard', label: 'Back to the dashboard' }}
      sections={[
        {
          id: 'projection-window',
          title: 'The projection window',
          body: (
            <>
              <Text>
                Project chat on the dashboard opens a separate window; move it to the projector. It
                shows the class chat and nothing else.
              </Text>
              <List>
                <List.Item>
                  Students appear only by their anonymous names, never real names.
                </List.Item>
                <List.Item>
                  A message you hide on the dashboard disappears from the window within about a
                  second.
                </List.Item>
                <List.Item>Cold-call draws and their outcomes never appear.</List.Item>
                <List.Item>
                  Access lasts until the class&apos;s scheduled end, or four hours at most. Ending
                  the class early does not close it, so close the window yourself. If the window
                  says its access expired, open it again from the dashboard.
                </List.Item>
              </List>
            </>
          ),
        },
        {
          id: 'slidev',
          title: 'Chat inside a Slidev deck',
          body: (
            <Text>
              Copy Slidev token on the dashboard gives a deck the access it needs. The deck&apos;s
              chat component shows the same anonymous chat as the projection window, with the same
              rules for hidden messages.
            </Text>
          ),
        },
      ]}
    />
  );
}
