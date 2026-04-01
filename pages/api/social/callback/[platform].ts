import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import { getSupabaseClient } from '@/lib/supabase';
import { encryptToken } from '@/lib/crypto';
import { parse, serialize } from 'cookie';

const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
const GRAPH_API = 'https://graph.facebook.com/v19.0';

type Platform = 'youtube' | 'instagram' | 'tiktok';

async function exchangeCode(platform: Platform, code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}> {
  const redirectUri = `${BASE_URL}/api/social/callback/${platform}`;

  if (platform === 'youtube') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`YouTube token exchange falhou: ${await res.text()}`);
    const data = await res.json();
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  if (platform === 'instagram') {
    // Step 1: Exchange code for short-lived token (Instagram Business Login)
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortRaw = await res.text();
    console.log('[instagram] short-lived token response:', shortRaw);
    if (!res.ok) throw new Error(`Instagram token exchange falhou: ${shortRaw}`);
    const shortData = JSON.parse(shortRaw);

    // Step 2: Exchange for long-lived token (valid 60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${shortData.access_token}`
    );
    const longRaw = await longRes.text();
    console.log('[instagram] long-lived token response:', longRaw);
    if (!longRes.ok) throw new Error(`Instagram long-lived token falhou: ${longRaw}`);
    const longData = JSON.parse(longRaw);

    return { accessToken: longData.access_token, expiresIn: longData.expires_in };
  }

  if (platform === 'tiktok') {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`TikTok token exchange falhou: ${await res.text()}`);
    const data = await res.json();
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  throw new Error('Plataforma desconhecida');
}

async function fetchPlatformProfile(platform: Platform, accessToken: string): Promise<{
  platformUserId: string;
  platformUsername: string;
  metadata: Record<string, any>;
}> {
  if (platform === 'youtube') {
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    const channel = data.items?.[0];
    return {
      platformUserId: channel?.id ?? '',
      platformUsername: channel?.snippet?.title ?? '',
      metadata: {},
    };
  }

  if (platform === 'instagram') {
    // Instagram Business Login: get user ID directly from Instagram Graph API
    const res = await fetch(
      `https://graph.instagram.com/me?fields=user_id,username&access_token=${accessToken}`
    );
    const raw = await res.text();
    console.log('[instagram] /me profile:', raw);
    if (!res.ok) throw new Error(`Instagram perfil falhou: ${raw}`);
    const data = JSON.parse(raw);

    return {
      platformUserId: String(data.user_id ?? data.id),
      platformUsername: data.username ?? '',
      metadata: {},
    };
  }

  if (platform === 'tiktok') {
    const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    const user = data.data?.user;
    return {
      platformUserId: user?.open_id ?? '',
      platformUsername: user?.display_name ?? '',
      metadata: {},
    };
  }

  throw new Error('Plataforma desconhecida');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { platform, code, state, error } = req.query as Record<string, string>;

  if (error) return res.redirect(`/?error=oauth_${error}`);
  if (!code || !state) return res.redirect('/?error=oauth_missing_params');

  // Validate CSRF state
  const cookies = parse(req.headers.cookie ?? '');
  const expectedState = cookies[`oauth_state_${platform}`];
  if (!expectedState || expectedState !== state) {
    return res.redirect('/?error=oauth_invalid_state');
  }

  // Clear the state cookie
  res.setHeader('Set-Cookie', serialize(`oauth_state_${platform}`, '', {
    httpOnly: true, maxAge: 0, path: '/',
  }));

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.redirect('/?error=not_authenticated');

  const userId = (session.user as any).id as string;
  if (!userId) return res.redirect('/?error=no_user_id');

  try {
    const { accessToken, refreshToken, expiresIn } = await exchangeCode(platform as Platform, code);
    const profile = await fetchPlatformProfile(platform as Platform, accessToken);

    const supabase = getSupabaseClient();

    // For Instagram, use page_access_token for publishing instead of the user token
    const tokenToStore = platform === 'instagram'
      ? (profile.metadata.page_access_token ?? accessToken)
      : accessToken;

    const encryptedAccess = encryptToken(tokenToStore);
    const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await supabase.from('social_accounts').upsert(
      {
        user_id: userId,
        platform,
        platform_user_id: profile.platformUserId,
        platform_username: profile.platformUsername,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: expiresAt,
        metadata: { ...profile.metadata, page_access_token: undefined }, // don't double-store token in metadata
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform,platform_user_id' }
    );

    res.redirect(`/?connected=${platform}`);
  } catch (err: any) {
    console.error(`[social/callback] ${platform} error:`, err.message);
    res.redirect(`/?error=oauth_failed&platform=${platform}&msg=${encodeURIComponent(err.message)}`);
  }
}
