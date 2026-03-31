import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseClient } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id: jobId } = req.query as { id: string };
  const supabase = getSupabaseClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('cuts')
      .select('*')
      .eq('job_id', jobId)
      .order('clip_index', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method === 'POST') {
    const { clips } = req.body as {
      clips: { clip_index: number; title: string; start_time: number; end_time: number }[];
    };

    if (!clips?.length) return res.status(400).json({ error: 'clips é obrigatório' });

    // Remove cuts anteriores pendentes para os mesmos índices (re-enfileiramento)
    await supabase.from('cuts').delete()
      .eq('job_id', jobId)
      .in('clip_index', clips.map(c => c.clip_index))
      .in('status', ['pending', 'error']);

    const rows = clips.map(c => ({ job_id: jobId, ...c, status: 'pending' }));
    const { data, error } = await supabase.from('cuts').insert(rows).select();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
