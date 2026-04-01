import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
});

export const FREE_CUTS_LIMIT = 10;

export const PLANS = {
  free: {
    name: 'Free',
    cutsPerMonth: FREE_CUTS_LIMIT,
    priceId: null,
  },
  pro: {
    name: 'Pro',
    cutsPerMonth: Infinity,
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
  },
} as const;

export type PlanId = keyof typeof PLANS;
