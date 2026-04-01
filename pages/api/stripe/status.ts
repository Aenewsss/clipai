import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { FREE_CUTS_LIMIT } from '@/lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseClient();

  const { data: dbUser } = await supabase
    .from('users')
    .select('subscription_status')
    .eq('id', user.id)
    .single();

  const plan: string = dbUser?.subscription_status ?? 'free';

  // Busca os job IDs do usuário
  const { data: userJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('user_id', user.id);

  const jobIds = (userJobs ?? []).map((j: { id: string }) => j.id);

  let cutsThisMonth = 0;
  if (jobIds.length > 0) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from('cuts')
      .select('id', { count: 'exact', head: true })
      .in('job_id', jobIds)
      .gte('created_at', startOfMonth.toISOString())
      .neq('status', 'error');

    cutsThisMonth = count ?? 0;
  }

  return res.status(200).json({
    plan,
    cutsThisMonth,
    cutsLimit: plan === 'pro' ? null : FREE_CUTS_LIMIT,
    canCut: plan === 'pro' || cutsThisMonth < FREE_CUTS_LIMIT,
  });
}
