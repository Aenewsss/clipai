import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getSupabaseClient } from '@/lib/supabase';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Upsert user in Supabase
      const supabase = getSupabaseClient();
      await supabase.from('users').upsert(
        { email: user.email, name: user.name, image: user.image, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Fetch our internal user ID from Supabase
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from('users')
          .select('id')
          .eq('email', user.email)
          .single();
        if (data) token.userId = data.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && session.user) {
        (session.user as any).id = token.userId;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
};

export default NextAuth(authOptions);
