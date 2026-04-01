import type { SocialProvider, PublishOptions, PublishResult, TokenRefreshResult } from './types';

export class YouTubeProvider implements SocialProvider {
  platform = 'youtube' as const;

  async publish({ videoUrl, title, description = '', accessToken }: PublishOptions): Promise<PublishResult> {
    // 1. Download the video buffer from Supabase public URL
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Falha ao baixar vídeo: ${videoRes.statusText}`);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const contentLength = videoBuffer.byteLength;

    // 2. Initiate resumable upload
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(contentLength),
        },
        body: JSON.stringify({
          snippet: {
            title: title.slice(0, 100),
            description,
            categoryId: '22', // People & Blogs
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`YouTube init upload falhou: ${err}`);
    }

    const uploadUri = initRes.headers.get('location');
    if (!uploadUri) throw new Error('YouTube não retornou upload URI');

    // 3. Upload the video
    const uploadRes = await fetch(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(contentLength),
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 201) {
      const err = await uploadRes.text();
      throw new Error(`YouTube upload falhou: ${err}`);
    }

    const data = await uploadRes.json();
    const videoId = data.id;
    if (!videoId) throw new Error('YouTube não retornou video ID');

    return {
      platformPostId: videoId,
      platformPostUrl: `https://www.youtube.com/shorts/${videoId}`,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    });

    if (!res.ok) throw new Error(`YouTube token refresh falhou: ${await res.text()}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
