-- ============================================================
-- Migração Stripe — Planos e Assinaturas
-- Execute no Supabase: Dashboard → SQL Editor
-- ============================================================

-- 1. Adiciona colunas de Stripe e assinatura na tabela users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_id TEXT;

-- Índice para lookup por customer_id (usado nos webhooks)
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- 2. Adiciona user_id na tabela jobs (para rastrear cortes por usuário)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON jobs(user_id);

-- 3. (Opcional) Confirma que o constraint de subscription_status é válido
-- ALTER TABLE users ADD CONSTRAINT subscription_status_check
--   CHECK (subscription_status IN ('free', 'pro', 'cancelled'));

-- ============================================================
-- Verificação
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name IN ('stripe_customer_id', 'subscription_status', 'subscription_id');
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'jobs' AND column_name = 'user_id';
