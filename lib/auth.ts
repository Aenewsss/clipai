import { getServerSession, type NextAuthOptions } from 'next-auth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

export async function getServerUser(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  return session?.user ?? null;
}

export async function requireUser(req: NextApiRequest, res: NextApiResponse) {
  const user = await getServerUser(req, res);
  if (!user) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }
  return user as { id: string; name?: string | null; email?: string | null; image?: string | null };
}
