import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseClient();
  const { data: dbUser } = await supabase
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (!dbUser?.stripe_customer_id) {
    return res.status(400).json({ error: 'Sem assinatura ativa' });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

  const session = await stripe.billingPortal.sessions.create({
    customer: dbUser.stripe_customer_id,
    return_url: baseUrl,
  });

  return res.status(200).json({ url: session.url });
}
