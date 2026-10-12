import { useSession, signIn, signOut } from 'next-auth/react';
import { Button } from '@mantine/core';

export default function AuthIcon() {
  const { data: session } = useSession();

  return (
    <div className="flex items-center p-4">
      <div className="grow"></div>
      <div className="flex-shrink bg-black pb-0 p-2 rounded-full">
        {!session ? (
          <Button onClick={() => signIn('google')}>Sign In</Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-white text-sm">{session.user?.email}</span>
            <Button size="sm" onClick={() => signOut()}>
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
