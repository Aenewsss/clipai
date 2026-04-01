import type { NextApiRequest, NextApiResponse } from 'next';
import { stripe } from '@/lib/stripe';
import { getSupabaseClient } from '@/lib/supabase';
import type Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function updateSubscription(
  supabase: ReturnType<typeof import('@/lib/supabase').getSupabaseClient>,
  customerId: string,
  subscription: Stripe.Subscription
) {
  const status = subscription.status === 'active' || subscription.status === 'trialing'
    ? 'pro'
    : 'free';

  const { error } = await supabase
    .from('users')
    .update({
      subscription_status: status,
      subscription_id: subscription.id,
    })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('[stripe webhook] falha ao atualizar subscription:', error.message);
  } else {
    console.log(`[stripe webhook] usuário ${customerId} atualizado para plano ${status}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Sem assinatura Stripe' });

  const rawBody = await getRawBody(req);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return res.status(400).json({ error: `Webhook inválido: ${err.message}` });
  }

  const supabase = getSupabaseClient();

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await updateSubscription(supabase, sub.customer as string, sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await supabase
        .from('users')
        .update({ subscription_status: 'free', subscription_id: null })
        .eq('stripe_customer_id', sub.customer as string);
      break;
    }
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await updateSubscription(supabase, session.customer as string, sub);
      }
      break;
    }
  }

  return res.status(200).json({ received: true });
}
