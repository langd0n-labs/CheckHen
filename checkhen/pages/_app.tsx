import '../public/index.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import type { AppProps } from 'next/app';
import Head from 'next/head';
import { SessionProvider } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from '../theme';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { useRouter } from 'next/router';

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
        {router.pathname !== '/projection' && <SessionScopePicker />}
        <Component {...pageProps} />
      </MantineProvider>
    </SessionProvider>
  );
}
