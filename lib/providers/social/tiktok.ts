import type { SocialProvider, PublishOptions, PublishResult, TokenRefreshResult } from './types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export class TikTokProvider implements SocialProvider {
  platform = 'tiktok' as const;

  async publish({ videoUrl, title, accessToken }: PublishOptions): Promise<PublishResult> {
    // 1. Init upload — TikTok pulls from URL
    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: title.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl,
        },
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`TikTok init falhou: ${err}`);
    }

    const initData = await initRes.json();
    if (initData.error?.code && initData.error.code !== 'ok') {
      throw new Error(`TikTok init erro: ${initData.error.message}`);
    }

    const publishId = initData.data?.publish_id;
    if (!publishId) throw new Error('TikTok não retornou publish_id');

    // 2. Poll publish status
    const postId = await this.pollPublishStatus(publishId, accessToken);

    return {
      platformPostId: postId,
      platformPostUrl: `https://www.tiktok.com/@me/video/${postId}`,
    };
  }

  private async pollPublishStatus(publishId: string, accessToken: string): Promise<string> {
    const maxAttempts = 30;
    const delayMs = 5000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));

      const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const status = data.data?.status;

      if (status === 'PUBLISH_COMPLETE') {
        return data.data?.publicaly_available_post_id?.[0] ?? publishId;
      }
      if (status === 'FAILED') {
        throw new Error(`TikTok publicação falhou: ${data.data?.fail_reason ?? 'erro desconhecido'}`);
      }
    }

    throw new Error('TikTok: timeout aguardando publicação');
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      }),
    });

    if (!res.ok) throw new Error(`TikTok token refresh falhou: ${await res.text()}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
