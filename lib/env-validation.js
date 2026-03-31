const REQUIRED_BY_PROVIDER = {
  LLM_PROVIDER: {
    anthropic: ['ANTHROPIC_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
  },
  TRANSCRIPTION_PROVIDER: {
    groq: ['GROQ_API_KEY'],
  },
  STORAGE_PROVIDER: {
    supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    local: [],
  },
};

function validateEnv() {
  const missing = [];

  for (const [providerKey, variants] of Object.entries(REQUIRED_BY_PROVIDER)) {
    const selected = process.env[providerKey] ?? Object.keys(variants)[0];
    const required = variants[selected];

    if (!required) {
      missing.push(`${providerKey}="${selected}" não é válido. Use: ${Object.keys(variants).join(', ')}`);
      continue;
    }

    for (const key of required) {
      if (!process.env[key]) missing.push(`${key}  (requerido para ${providerKey}=${selected})`);
    }
  }

  if (missing.length > 0) {
    console.error('\n❌  Variáveis de ambiente faltando:\n');
    missing.forEach(m => console.error(`   • ${m}`));
    console.error('\n   Configure o arquivo .env.local e reinicie o servidor.\n');
    process.exit(1);
  }
}

module.exports = { validateEnv };
