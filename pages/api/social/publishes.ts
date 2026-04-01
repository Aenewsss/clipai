import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const { jobId, cutId } = req.query as { jobId?: string; cutId?: string };

  const supabase = getSupabaseClient();

  if (cutId) {
    const { data, error } = await supabase
      .from('publishes')
      .select('id, cut_id, platform, status, platform_post_id, platform_post_url, error, scheduled_at, created_at, updated_at')
      .eq('cut_id', cutId)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (jobId) {
    // Get all cuts for this job, then their publishes
    const { data: cuts } = await supabase
      .from('cuts')
      .select('id')
      .eq('job_id', jobId);

    if (!cuts?.length) return res.status(200).json([]);

    const cutIds = cuts.map(c => c.id);
    const { data, error } = await supabase
      .from('publishes')
      .select('id, cut_id, platform, status, platform_post_id, platform_post_url, error, scheduled_at, created_at, updated_at')
      .in('cut_id', cutIds)
      .order('created_at');

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  return res.status(400).json({ error: 'jobId ou cutId é obrigatório' });
}
