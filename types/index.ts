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
