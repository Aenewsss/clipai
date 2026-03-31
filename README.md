# ✂️ ClipAI — Cortes automáticos de vídeos com IA

Transforme vídeos longos do YouTube em clips virais para TikTok, Reels e Shorts usando inteligência artificial.

## Como funciona

1. **Cole a URL** de um vídeo do YouTube
2. **A IA transcreve** o vídeo usando legendas do YouTube (ou Groq Whisper)
3. **Claude analisa** a transcrição e identifica os melhores momentos
4. **Receba os cortes** com timestamps, ganchos e comandos ffmpeg prontos

## Stack

- **Frontend**: Next.js 14 (Pages Router) + TypeScript
- **Transcrição**: YouTube Captions API / Groq Whisper
- **Análise de Cortes**: Claude API (Anthropic)
- **Deploy**: Vercel

## Setup Local

```bash
# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env.local

# Preencher GROQ_API_KEY e ANTHROPIC_API_KEY no .env.local

# Rodar em desenvolvimento
npm run dev
```

## Deploy na Vercel

1. Faça push do código para o GitHub
2. Importe o repositório na [Vercel](https://vercel.com/new)
3. Adicione as variáveis de ambiente:
   - `GROQ_API_KEY`
   - `ANTHROPIC_API_KEY`
4. Deploy!

## Variáveis de Ambiente

| Variável | Descrição | Obter em |
|----------|-----------|----------|
| `GROQ_API_KEY` | API key da Groq (Whisper) | [console.groq.com](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | API key da Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

## Roadmap

- [ ] Download de áudio com yt-dlp (worker separado)
- [ ] Corte automático com ffmpeg (server-side)
- [ ] Geração de legendas estilo TikTok
- [ ] Preview dos clips na interface
- [ ] Upload direto pro TikTok via API
- [ ] Planos pagos com rate limiting

## Licença

MIT
