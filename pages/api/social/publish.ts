import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import type { SocialPlatform } from '@/lib/providers/social';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const { cutIds, platforms } = req.body as { cutIds: string[]; platforms: SocialPlatform[] };
  if (!cutIds?.length || !platforms?.length) {
    return res.status(400).json({ error: 'cutIds e platforms são obrigatórios' });
  }

  const supabase = getSupabaseClient();

  // Verify cuts belong to jobs accessible by the user (or are public — for now no strict ownership)
  const { data: cuts } = await supabase
    .from('cuts')
    .select('id, status, clip_url')
    .in('id', cutIds)
    .eq('status', 'done');

  if (!cuts?.length) return res.status(400).json({ error: 'Nenhum corte concluído encontrado' });

  // Get user social accounts for the requested platforms
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('user_id', user.id)
    .in('platform', platforms);

  if (!accounts?.length) return res.status(400).json({ error: 'Nenhuma conta social conectada para as plataformas solicitadas' });

  const rows: any[] = [];
  for (const cut of cuts) {
    for (const account of accounts) {
      // Skip if already has a pending or done publish for this cut+platform
      const { data: existing } = await supabase
        .from('publishes')
        .select('id')
        .eq('cut_id', cut.id)
        .eq('social_account_id', account.id)
        .in('status', ['pending', 'processing', 'done'])
        .maybeSingle();

      if (existing) continue;

      rows.push({
        cut_id: cut.id,
        social_account_id: account.id,
        platform: account.platform,
        status: 'pending',
      });
    }
  }

  if (!rows.length) return res.status(200).json({ created: 0, message: 'Já existem publicações para estes cortes' });

  const { data, error } = await supabase.from('publishes').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({ created: data.length, publishes: data });
}
