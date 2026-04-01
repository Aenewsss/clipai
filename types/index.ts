export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ClipSuggestion {
  title: string;
  hook: string;
  start_time: number;
  end_time: number;
  reason: string;
  viral_score: number;
  clip_url?: string;
}

export interface CutRequest {
  url: string;
  jobId: string;
  clips: Pick<ClipSuggestion, 'start_time' | 'end_time' | 'title'>[];
}

export interface CutClipResult {
  title: string;
  filename: string;
  url: string;
}

export interface CutResponse {
  clips: CutClipResult[];
}

export type CutStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Cut {
  id: string;
  job_id: string;
  clip_index: number;
  title: string;
  start_time: number;
  end_time: number;
  status: CutStatus;
  clip_url?: string;
  clip_vertical_url?: string;
  error?: string;
  created_at: string;
}

export type JobStep = 'queued' | 'downloading' | 'transcribing' | 'analyzing' | 'done' | 'error';
export type JobStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Job {
  id: string;
  url: string;
  style: string;
  min_duration: number;
  max_duration: number;
  status: JobStatus;
  step: JobStep;
  title?: string;
  transcript?: TranscriptSegment[];
  clips?: ClipSuggestion[];
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface VideoJob {
  id: string;
  url: string;
  status: 'pending' | 'downloading' | 'transcribing' | 'analyzing' | 'cutting' | 'done' | 'error';
  title?: string;
  transcript?: TranscriptSegment[];
  clips?: ClipSuggestion[];
  error?: string;
  createdAt: number;
}

export interface AnalyzeRequest {
  url: string;
  minDuration?: number;
  maxDuration?: number;
  style?: 'viral' | 'educational' | 'funny' | 'dramatic';
}

export interface AnalyzeResponse {
  jobId: string;
  status: string;
  title?: string;
  transcript?: TranscriptSegment[];
  clips?: ClipSuggestion[];
  error?: string;
}

// Planos e assinaturas
export type PlanStatus = 'free' | 'pro';

export interface UserPlanInfo {
  plan: PlanStatus;
  cutsThisMonth: number;
  cutsLimit: number | null;
  canCut: boolean;
}

// Social media
export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export type PublishStatus = 'pending' | 'processing' | 'done' | 'error';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  platform_user_id: string;
  platform_username: string;
  token_expires_at?: string;
  created_at: string;
}

export interface Publish {
  id: string;
  cut_id: string;
  platform: SocialPlatform;
  status: PublishStatus;
  platform_post_id?: string;
  platform_post_url?: string;
  error?: string;
  scheduled_at?: string;
  custom_title?: string;
  custom_description?: string;
  created_at: string;
  updated_at: string;
}
