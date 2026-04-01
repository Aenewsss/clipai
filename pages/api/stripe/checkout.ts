import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { stripe, PLANS } from '@/lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseClient();

  // Busca usuário por id ou email (fallback caso migração não tenha rodado ainda)
  let dbUser: { id: string; email: string; stripe_customer_id?: string | null } | null = null;

  if (user.id) {
    const { data } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', user.id)
      .single();
    if (data) dbUser = data;
  }

  // Fallback por email
  if (!dbUser && user.email) {
    const { data } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', user.email)
      .single();
    if (data) dbUser = data;
  }

  if (!dbUser) return res.status(404).json({ error: 'Usuário não encontrado' });

  // Tenta buscar stripe_customer_id (pode não existir se migração não rodou)
  try {
    const { data } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', dbUser.id)
      .single();
    if (data) dbUser.stripe_customer_id = data.stripe_customer_id;
  } catch {}

  // Cria ou recupera o customer no Stripe
  let customerId = dbUser.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: dbUser.email,
      metadata: { userId: dbUser.id },
    });
    customerId = customer.id;
    // Tenta salvar — pode falhar se migração não rodou, mas o checkout ainda funciona
    await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', dbUser.id);
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: PLANS.pro.priceId, quantity: 1 }],
    success_url: `${baseUrl}/?checkout=success`,
    cancel_url: `${baseUrl}/?checkout=cancelled`,
    metadata: { userId: dbUser.id },
  });

  return res.status(200).json({ url: session.url });
}
