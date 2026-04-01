import type { SocialPlatform, SocialProvider } from './types';
import { YouTubeProvider } from './youtube';
import { TikTokProvider } from './tiktok';
import { InstagramProvider } from './instagram';

export function createSocialProvider(platform: SocialPlatform): SocialProvider {
  switch (platform) {
    case 'youtube': return new YouTubeProvider();
    case 'tiktok': return new TikTokProvider();
    case 'instagram': return new InstagramProvider();
    default: throw new Error(`Plataforma social desconhecida: "${platform}"`);
  }
}

export type { SocialPlatform, SocialProvider, PublishOptions, PublishResult } from './types';
