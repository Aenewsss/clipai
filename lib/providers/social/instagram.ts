import type { SocialProvider, PublishOptions, PublishResult, TokenRefreshResult } from './types';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

export class InstagramProvider implements SocialProvider {
  platform = 'instagram' as const;

  async publish({ videoUrl, title, accessToken, platformUserId }: PublishOptions): Promise<PublishResult> {
    if (!platformUserId) throw new Error('Instagram requer platformUserId (ig_user_id)');

    // 1. Create media container
    const containerRes = await fetch(
      `${GRAPH_API}/${platformUserId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: videoUrl,
          caption: title,
          share_to_feed: true,
          access_token: accessToken,
        }),
      }
    );

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`Instagram container falhou: ${err}`);
    }

    const { id: containerId } = await containerRes.json();
    if (!containerId) throw new Error('Instagram não retornou container ID');

    // 2. Poll until container is ready
    await this.pollContainerStatus(containerId, accessToken);

    // 3. Publish
    const publishRes = await fetch(
      `${GRAPH_API}/${platformUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`Instagram publish falhou: ${err}`);
    }

    const { id: mediaId } = await publishRes.json();

    return {
      platformPostId: mediaId,
      platformPostUrl: `https://www.instagram.com/p/${mediaId}/`,
    };
  }

  private async pollContainerStatus(containerId: string, accessToken: string): Promise<void> {
    const maxAttempts = 24; // 2 min máximo
    const delayMs = 5000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));

      const res = await fetch(
        `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`
      );

      if (!res.ok) continue;
      const data = await res.json();

      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
        throw new Error(`Instagram container falhou com status: ${data.status_code}`);
      }
    }

    throw new Error('Instagram: timeout aguardando container');
  }

  async refreshAccessToken(accessToken: string): Promise<TokenRefreshResult> {
    // Instagram long-lived tokens (60 days) are refreshed using the current token
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${accessToken}`
    );

    if (!res.ok) throw new Error(`Instagram token refresh falhou: ${await res.text()}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5184000) * 1000),
    };
  }
}
