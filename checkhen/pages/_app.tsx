import '../public/index.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SessionProvider } from 'next-auth/react';
import { Alert, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { useDemoFull } from '@/lib/use-mode';
import { theme } from '../theme';

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter();
  const demoFull = useDemoFull();
  return (
    <SessionProvider session={session}>
      <MantineProvider theme={theme}>
        <Notifications />
        <Head>
          <title>CheckHen</title>
          <meta
            name="viewport"
            content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
          />
          <link rel="shortcut icon" href="/favicon.svg" />
        </Head>
        {demoFull && (
          <Alert color="yellow" radius={0} title="This demo is full">
            It has reached its storage limit, so you can look around but changes are not
            saved. It will be reset soon.
          </Alert>
        )}
        {/* The call screen shows its own compact scope line to keep both taps on one screen. */}
        {/* The student page and call screen fill the screen and choose their own session. */}
        {!['/', '/projection', '/admin/call', '/demo'].includes(router.pathname) &&
          !router.pathname.startsWith('/help') && <SessionScopePicker />}
        <Component {...pageProps} />
      </MantineProvider>
    </SessionProvider>
  );
}
