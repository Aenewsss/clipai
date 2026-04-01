import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, platform, platform_user_id, platform_username, token_expires_at, created_at')
    .eq('user_id', user.id)
    .order('platform');

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data ?? []);
}
