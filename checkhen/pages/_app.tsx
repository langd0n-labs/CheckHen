import '../public/index.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SessionProvider } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { theme } from '../theme';

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter();
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
        {/* The call screen shows its own compact scope line to keep both taps on one screen. */}
        {/* The student page and call screen fill the screen and choose their own session. */}
        {!['/', '/projection', '/admin/call'].includes(router.pathname) &&
          !router.pathname.startsWith('/help') && <SessionScopePicker />}
        <Component {...pageProps} />
      </MantineProvider>
    </SessionProvider>
  );
}
