import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { FREE_CUTS_LIMIT } from '@/lib/stripe';

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
    const user = await requireUser(req, res);
    if (!user) return;

    const { clips } = req.body as {
      clips: { clip_index: number; title: string; start_time: number; end_time: number }[];
    };

    if (!clips?.length) return res.status(400).json({ error: 'clips é obrigatório' });

    // Verifica se o job pertence ao usuário
    const { data: job } = await supabase
      .from('jobs')
      .select('user_id')
      .eq('id', jobId)
      .single();

    if (job?.user_id && job.user_id !== user.id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Busca status de assinatura do usuário
    const { data: dbUser } = await supabase
      .from('users')
      .select('subscription_status')
      .eq('id', user.id)
      .single();

    const plan = dbUser?.subscription_status ?? 'free';

    if (plan !== 'pro') {
      // Conta cortes deste mês para o usuário
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

      const remaining = FREE_CUTS_LIMIT - cutsThisMonth;
      if (remaining <= 0) {
        return res.status(402).json({
          error: 'Limite de cortes gratuitos atingido',
          cutsThisMonth,
          cutsLimit: FREE_CUTS_LIMIT,
          upgrade: true,
        });
      }

      // Se o lote exceder o restante, recusa para evitar parcialmente
      if (clips.length > remaining) {
        return res.status(402).json({
          error: `Você tem apenas ${remaining} corte(s) gratuito(s) restante(s) este mês`,
          cutsThisMonth,
          cutsLimit: FREE_CUTS_LIMIT,
          remaining,
          upgrade: true,
        });
      }
    }

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
