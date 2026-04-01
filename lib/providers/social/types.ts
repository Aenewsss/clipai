export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export type PublishStatus = 'pending' | 'processing' | 'done' | 'error';

export interface PublishOptions {
  videoUrl: string;
  title: string;
  description?: string;
  accessToken: string;
  refreshToken?: string;
  platformUserId?: string;
  metadata?: Record<string, any>;
}

export interface PublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

export interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface SocialProvider {
  platform: SocialPlatform;
  publish(options: PublishOptions): Promise<PublishResult>;
  refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult>;
}
