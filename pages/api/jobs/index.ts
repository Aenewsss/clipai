import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseClient } from '@/lib/supabase';
import { getServerUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, status, step, created_at')
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, style = 'viral', min_duration = 60, max_duration = 90 } = req.body;
  if (!url) return res.status(400).json({ error: 'url é obrigatória' });

  // Tenta pegar o usuário logado (opcional para não quebrar fluxo existente)
  const user = await getServerUser(req, res) as { id?: string; email?: string | null } | null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      url,
      style,
      min_duration,
      max_duration,
      status: 'pending',
      step: 'queued',
      ...(user?.id ? { user_id: user.id } : {}),
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ jobId: data.id });
}
