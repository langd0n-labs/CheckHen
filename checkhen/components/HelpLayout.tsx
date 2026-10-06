import type { ReactNode } from 'react';
import Link from 'next/link';
import { Anchor, Box, List, Stack, Text, Title } from '@mantine/core';

export type HelpSection = { id: string; title: string; body: ReactNode };

/**
 * A plain bulleted list. Mantine's List item wrapper takes the full width plus the
 * indent, which overflows a phone screen by a few pixels.
 */
export function HelpList({ children }: { children: ReactNode }) {
  return (
    <Box component="ul" m={0} pl="lg" style={{ display: 'grid', gap: 6 }}>
      {children}
    </Box>
  );
}
HelpList.Item = function HelpListItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
};

/** A help page: one reading column, a list of its sections, and an anchor per section. */
export function HelpLayout({
  title,
  intro,
  back,
  sections,
}: {
  title: string;
  intro: ReactNode;
  back: { href: string; label: string };
  sections: HelpSection[];
}) {
  return (
    <Box component="main" px="md" py="xl" maw={720} mx="auto">
      <Anchor component={Link} href={back.href} size="sm">
        {back.label}
      </Anchor>
      <Title order={1} mt="sm" mb="xs">
        {title}
      </Title>
      <Text size="lg" mb="lg">
        {intro}
      </Text>
      <Box component="nav" aria-label="On this page" mb="xl">
        <List spacing={4}>
          {sections.map((section) => (
            <List.Item key={section.id}>
              <Anchor href={`#${section.id}`}>{section.title}</Anchor>
            </List.Item>
          ))}
        </List>
      </Box>
      <Stack gap="xl">
        {sections.map((section) => (
          <Box component="section" key={section.id} id={section.id} style={{ scrollMarginTop: 16 }}>
            <Title order={2} fz={24} mb="sm">
              {section.title}
            </Title>
            <Stack gap="sm" style={{ lineHeight: 1.6 }}>
              {section.body}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
