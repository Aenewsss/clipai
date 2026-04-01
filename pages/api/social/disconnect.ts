import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const { accountId } = req.body as { accountId: string };
  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório' });

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('social_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', user.id); // ensures ownership

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
