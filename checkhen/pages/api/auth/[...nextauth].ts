import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { DEMO_DOMAIN, DEMO_INSTRUCTOR, isDemo } from '@/lib/demo';
import { prisma } from '@/lib/prisma';

/**
 * Demo mode signs in as a seeded persona instead of Google. It accepts only demo
 * addresses, so a demo deployment cannot admit a real account.
 */
const demoProvider = CredentialsProvider({
  id: 'demo',
  name: 'Demo persona',
  credentials: { email: { label: 'Persona', type: 'text' } },
  async authorize(credentials) {
    const email = String(credentials?.email ?? '');
    if (!email.endsWith(`@${DEMO_DOMAIN}`)) {
      return null;
    }
    const user = await prisma.user.findUnique({ where: { email } });
    return user ? { id: user.id, email: user.email, name: user.displayName } : null;
  },
});

export const authOptions = {
  providers: isDemo()
    ? [demoProvider]
    : [
        GoogleProvider({
          clientId: process.env.AUTH_GOOGLE_ID || '',
          clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
          authorization: {
            params: {
              prompt: 'select_account',
              scope: 'openid email profile',
              hd: process.env.NEXT_PUBLIC_EMAIL_DOMAIN || 'bu.edu',
            },
          },
        }),
      ],
  callbacks: {
    async signIn({ user, profile }: any) {
      if (!user.email) {
        return false;
      }
      if (isDemo()) {
        return user.email.endsWith(`@${DEMO_DOMAIN}`);
      }
      const domain = (process.env.NEXT_PUBLIC_EMAIL_DOMAIN || 'bu.edu').toLowerCase();
      const allowed =
        user.email.toLowerCase().endsWith(`@${domain}`) &&
        profile?.email_verified === true &&
        profile?.hd?.toLowerCase() === domain;
      if (!allowed) {
        return false;
      }

      const adminEmails =
        process.env.ADMIN_EMAILS?.split(',').map(
          (e) => `${e.trim()}@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`
        ) || [];

      // On first sign-in seed profile picture from Google; on subsequent sign-ins preserve any custom upload
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          email: user.email,
          profilePicture: user.image ?? undefined,
          isAdmin: adminEmails.includes(user.email),
        },
      });
      return true;
    },
    async jwt({ token, user }: any) {
      // Embed isAdmin into the JWT at sign-in so it's available on every request
      if (user?.email && isDemo()) {
        token.isAdmin = user.email === DEMO_INSTRUCTOR;
      } else if (user?.email) {
        const adminEmails =
          process.env.ADMIN_EMAILS?.split(',').map(
            (e) => `${e.trim()}@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`
          ) || [];
        token.isAdmin = adminEmails.includes(user.email);
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user && token.email) {
        session.user.email = token.email as string;
        session.user.isAdmin = (token.isAdmin as boolean) ?? false;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    error: '/',
    // Demo mode signs in on the persona picker.
    ...(isDemo() ? { signIn: '/demo' } : {}),
  },
};

export default NextAuth(authOptions);
