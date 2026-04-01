import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';

const PAGE_SIZE = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const page = Math.max(0, parseInt(String(req.query.page ?? '0')));
  const offset = page * PAGE_SIZE;

  const supabase = getSupabaseClient();

  // Fetch done cuts joined with job title/url
  const { data: cuts, error, count } = await supabase
    .from('cuts')
    .select('id, job_id, clip_index, title, start_time, end_time, clip_url, clip_vertical_url, created_at, jobs(title, url)', { count: 'exact' })
    .eq('status', 'done')
    .not('clip_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) return res.status(500).json({ error: error.message });
  if (!cuts?.length) return res.status(200).json({ cuts: [], publishes: [], total: 0 });

  // Fetch publish status for all returned cuts
  const cutIds = cuts.map(c => c.id);
  const { data: publishes } = await supabase
    .from('publishes')
    .select('id, cut_id, platform, status, platform_post_url, error, scheduled_at, updated_at')
    .in('cut_id', cutIds)
    .order('created_at');

  return res.status(200).json({
    cuts,
    publishes: publishes ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  });
}
