import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseClient } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query as { id: string };
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, step, title, transcript, clips, error, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Job não encontrado' });
  return res.status(200).json(data);
}
