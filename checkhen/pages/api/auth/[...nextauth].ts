import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
      authorization: {
        params: { prompt: 'select_account' },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }: any) {
      if (!user.email) return false;
      // Allow BU domain
      const allowedDomain = `@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`;
      const testEmails = process.env.ALLOWED_TEST_EMAILS?.split(',').map((e) => e.trim()) || [];
      const allowed = user.email.endsWith(allowedDomain) || testEmails.includes(user.email);
      if (!allowed) return false;

      const adminEmails = process.env.ADMIN_EMAILS?.split(',')
        .map((e) => `${e.trim()}@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`) || [];

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
      if (user?.email) {
        const adminEmails = process.env.ADMIN_EMAILS?.split(',')
          .map((e) => `${e.trim()}@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN}`) || [];
        token.isAdmin = adminEmails.includes(user.email);
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user && token.email) {
        session.user.email = token.email as string;
        session.user.isAdmin = token.isAdmin as boolean ?? false;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    error: '/',
  },
};

export default NextAuth(authOptions);
