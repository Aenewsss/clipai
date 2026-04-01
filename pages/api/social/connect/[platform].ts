import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import { serialize } from 'cookie';
import { randomBytes } from 'crypto';

const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

const PLATFORM_CONFIG = {
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: () => process.env.GOOGLE_CLIENT_ID!,
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    extraParams: { access_type: 'offline', prompt: 'consent' },
  },
  instagram: {
    authUrl: 'https://www.instagram.com/oauth/authorize',
    clientId: () => process.env.INSTAGRAM_APP_ID!,
    scope: 'instagram_business_basic,instagram_business_content_publish',
    extraParams: { force_reauth: 'true' },
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    clientId: () => process.env.TIKTOK_CLIENT_KEY!,
    scope: 'user.info.basic',
    extraParams: {},
  },
} as const;

type Platform = keyof typeof PLATFORM_CONFIG;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: 'Não autenticado' });

  const { platform } = req.query as { platform: string };
  if (!(platform in PLATFORM_CONFIG)) {
    return res.status(400).json({ error: `Plataforma inválida: ${platform}` });
  }

  const config = PLATFORM_CONFIG[platform as Platform];
  const state = randomBytes(16).toString('hex');
  const redirectUri = `${BASE_URL}/api/social/callback/${platform}`;

  // Store state in httpOnly cookie for CSRF validation
  res.setHeader('Set-Cookie', serialize(`oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  }));

  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scope,
    state,
    ...config.extraParams,
  });

  // TikTok uses client_key instead of client_id
  if (platform === 'tiktok') {
    params.delete('client_id');
    params.set('client_key', config.clientId());
  }

  const finalUrl = `${config.authUrl}?${params.toString()}`;
  console.log(`[social/connect] ${platform} redirect URL:`, finalUrl);
  res.redirect(finalUrl);
}
