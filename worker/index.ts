import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { downloadYouTubeAudio } from '../lib/youtube-audio';
import { transcribeAudio } from '../lib/transcription';
import { analyzeTranscript } from '../lib/analyzer';
import { downloadAndCutClip } from '../lib/clip-cutter';
import { generateVerticalClip } from '../lib/vertical-crop';
import { getVideoInfo } from '../lib/youtube';
import { createLLMProvider } from '../lib/providers/llm';
import { createTranscriptionProvider } from '../lib/providers/transcription';
import { createStorageProvider } from '../lib/providers/storage';
import { createSocialProvider } from '../lib/providers/social';
import { decryptToken, encryptToken } from '../lib/crypto';

const POLL_INTERVAL_MS = 5000;

// Concurrency limits — how many items can run simultaneously
const JOB_CONCURRENCY = 2;
const CUT_CONCURRENCY = 3;
const PUBLISH_CONCURRENCY = 2;

// Simple semaphore to control concurrency without external dependencies issues
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    get activeCount() { return active; },
    get pendingCount() { return queue.length; },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const attempt = () => {
          if (active >= limit) {
            queue.push(attempt);
            return;
          }
          active++;
          fn().then(resolve, reject).finally(() => {
            active--;
            if (queue.length > 0) queue.shift()!();
          });
        };
        attempt();
      });
    },
  };
}

const jobSem = createSemaphore(JOB_CONCURRENCY);
const cutSem = createSemaphore(CUT_CONCURRENCY);
const publishSem = createSemaphore(PUBLISH_CONCURRENCY);

async function generateAndUploadVertical(
  supabase: ReturnType<typeof getClient>,
  cut: { id: string; job_id: string; clip_url: string; filename?: string }
): Promise<string> {
  const id = randomBytes(6).toString('hex');
  const inputPath = join(tmpdir(), `clipai_pub_in_${id}.mp4`);
  const outputPath = join(tmpdir(), `clipai_pub_out_${id}.mp4`);

  // Download horizontal clip from storage
  const res = await fetch(cut.clip_url);
  if (!res.ok) throw new Error(`Falha ao baixar clip para gerar vertical: ${res.status}`);
  await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

  try {
    console.log(`[worker] Gerando versão vertical para cut ${cut.id}...`);
    await generateVerticalClip(inputPath, outputPath);
    const verticalBuffer = await readFile(outputPath);

    const storage = createStorageProvider();
    const verticalKey = `${cut.job_id}/vertical_${id}.mp4`;
    const verticalUrl = await storage.upload(verticalKey, verticalBuffer, 'video/mp4');

    await supabase.from('cuts').update({
      clip_vertical_url: verticalUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', cut.id);

    console.log(`[worker] Vertical gerado e salvo: ${verticalUrl}`);
    return verticalUrl;
  } finally {
    unlink(inputPath).catch(() => {});
    unlink(outputPath).catch(() => {});
  }
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  return createClient(url, key);
}

async function updateJob(supabase: ReturnType<typeof getClient>, id: string, fields: Record<string, unknown>) {
  await supabase.from('jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
}

async function processJob(supabase: ReturnType<typeof getClient>, job: any) {
  const { id, url, style, min_duration, max_duration } = job;
  console.log(`[worker] Processing job ${id}: ${url}`);

  try {
    // 1. Get title (status already set to 'processing' by claimItems)
    await updateJob(supabase, id, { step: 'downloading' });
    const info = await getVideoInfo(url);
    const title = info?.title || 'Vídeo sem título';

    // 2. Download + transcribe
    const { buffer, ext } = await downloadYouTubeAudio(url);
    await updateJob(supabase, id, { step: 'transcribing', title });

    const transcriptionProvider = createTranscriptionProvider();
    const transcript = await transcribeAudio(buffer, `audio.${ext}`, transcriptionProvider);
    await updateJob(supabase, id, { step: 'analyzing', transcript });

    // 3. Analyze
    const llm = createLLMProvider();
    const clips = await analyzeTranscript(transcript, title, { minDuration: min_duration, maxDuration: max_duration, style }, llm);
    await updateJob(supabase, id, { status: 'done', step: 'done', clips });

    console.log(`[worker] Job ${id} done — ${clips.length} clips`);
  } catch (err: any) {
    console.error(`[worker] Job ${id} failed:`, err.message);
    await updateJob(supabase, id, { status: 'error', step: 'error', error: err.message });
  }
}

async function processCut(supabase: ReturnType<typeof getClient>, cut: any) {
  const { id, job_id, clip_index, title, start_time, end_time } = cut;
  console.log(`[worker] Cutting clip ${clip_index + 1}: ${title}`);
  // status already set to 'processing' by claimItems

  try {
    const { data: job } = await supabase.from('jobs').select('url').eq('id', job_id).single();
    if (!job) throw new Error('Job não encontrado');

    const storage = createStorageProvider();
    const result = await downloadAndCutClip(job.url, { start_time, end_time, title }, clip_index);

    const key = `${job_id}/${result.filename}`;
    const clipUrl = await storage.upload(key, result.buffer, 'video/mp4');

    let clipVerticalUrl: string | null = null;
    if (result.verticalBuffer && result.verticalFilename) {
      const verticalKey = `${job_id}/${result.verticalFilename}`;
      clipVerticalUrl = await storage.upload(verticalKey, result.verticalBuffer, 'video/mp4');
      console.log(`[worker] Vertical cut uploaded: ${clipVerticalUrl}`);
    }

    await supabase.from('cuts').update({
      status: 'done',
      clip_url: clipUrl,
      clip_vertical_url: clipVerticalUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    console.log(`[worker] Cut done: ${title} → ${clipUrl}`);
  } catch (err: any) {
    console.error(`[worker] Cut ${id} failed:`, err.message);
    await supabase.from('cuts').update({
      status: 'error', error: err.message, updated_at: new Date().toISOString(),
    }).eq('id', id);
  }
}

async function processPublish(supabase: ReturnType<typeof getClient>, publish: any) {
  const { id, cut_id, social_account_id, platform, custom_title, custom_description } = publish;
  console.log(`[worker] Publishing cut ${cut_id} to ${platform}...`);
  // status already set to 'processing' by claimItems

  try {
    // Fetch social account (with encrypted tokens)
    const { data: account } = await supabase
      .from('social_accounts')
      .select('access_token, refresh_token, token_expires_at, platform_user_id, metadata')
      .eq('id', social_account_id)
      .single();

    if (!account) throw new Error('Conta social não encontrada');

    // Decrypt tokens
    let accessToken = decryptToken(account.access_token);
    let refreshToken = account.refresh_token ? decryptToken(account.refresh_token) : undefined;

    // Refresh token if expired or expiring within 5 minutes
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : null;
    const isExpiring = expiresAt && expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (isExpiring && refreshToken) {
      console.log(`[worker] Refreshing ${platform} token for account ${social_account_id}`);
      const provider = createSocialProvider(platform);
      const refreshed = await provider.refreshAccessToken(refreshToken);

      accessToken = refreshed.accessToken;
      if (refreshed.refreshToken) refreshToken = refreshed.refreshToken;

      await supabase.from('social_accounts').update({
        access_token: encryptToken(accessToken),
        refresh_token: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : account.refresh_token,
        token_expires_at: refreshed.expiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', social_account_id);
    }

    // Fetch cut details
    const { data: cut } = await supabase
      .from('cuts')
      .select('clip_url, clip_vertical_url, title')
      .eq('id', cut_id)
      .single();

    if (!cut?.clip_url) throw new Error('Corte sem URL de vídeo');

    // Use vertical version for all social platforms (Reels, Shorts, TikTok)
    // If vertical doesn't exist yet, generate it now before publishing
    let verticalUrl = cut.clip_vertical_url;
    if (!verticalUrl) {
      try {
        const { data: cutRow } = await supabase.from('cuts').select('job_id').eq('id', cut_id).single();
        verticalUrl = await generateAndUploadVertical(supabase, {
          id: cut_id,
          job_id: cutRow?.job_id ?? cut_id,
          clip_url: cut.clip_url,
        });
      } catch (err: any) {
        console.warn(`[worker] Falha ao gerar vertical, usando horizontal: ${err.message}`);
      }
    }
    const videoUrl = verticalUrl ?? cut.clip_url;

    // Publish
    const socialProvider = createSocialProvider(platform);
    const result = await socialProvider.publish({
      videoUrl,
      title: custom_title ?? cut.title,
      description: custom_description,
      accessToken,
      refreshToken,
      platformUserId: account.platform_user_id,
      metadata: account.metadata,
    });

    await supabase.from('publishes').update({
      status: 'done',
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    console.log(`[worker] Published to ${platform}: ${result.platformPostUrl}`);
  } catch (err: any) {
    console.error(`[worker] Publish ${id} failed:`, err.message);
    await supabase.from('publishes').update({
      status: 'error',
      error: err.message,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  }
}

// Atomically claim pending items from a table to avoid double-processing.
// Sets status='processing' only if still 'pending' (optimistic lock).
async function claimItems(
  supabase: ReturnType<typeof getClient>,
  table: string,
  slots: number,
  extraFilter?: (q: any) => any
): Promise<any[]> {
  if (slots <= 0) return [];

  let query = (supabase.from(table) as any)
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(slots);

  if (extraFilter) query = extraFilter(query);

  const { data: candidates } = await query;
  if (!candidates?.length) return [];

  const claimed: any[] = [];
  for (const item of candidates) {
    const { data } = await supabase
      .from(table)
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending') // only update if still pending (race condition guard)
      .select('*')
      .maybeSingle();

    if (data) claimed.push(data);
  }
  return claimed;
}

async function poll(supabase: ReturnType<typeof getClient>) {
  // Jobs — analysis (download + transcribe + analyze)
  const freeJobSlots = JOB_CONCURRENCY - jobSem.activeCount - jobSem.pendingCount;
  if (freeJobSlots > 0) {
    const jobs = await claimItems(supabase, 'jobs', freeJobSlots);
    for (const job of jobs) {
      jobSem.run(() => processJob(supabase, job)).catch(() => {});
    }
  }

  // Cuts — video cutting with ffmpeg
  const freeCutSlots = CUT_CONCURRENCY - cutSem.activeCount - cutSem.pendingCount;
  if (freeCutSlots > 0) {
    const cuts = await claimItems(supabase, 'cuts', freeCutSlots);
    for (const cut of cuts) {
      cutSem.run(() => processCut(supabase, cut)).catch(() => {});
    }
  }

  // Publishes — social media posting (respecting scheduled_at and rate limits)
  const freePublishSlots = PUBLISH_CONCURRENCY - publishSem.activeCount - publishSem.pendingCount;
  if (freePublishSlots > 0) {
    const now = new Date().toISOString();
    const publishes = await claimItems(supabase, 'publishes', freePublishSlots, (q) =>
      q.or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
       .order('scheduled_at', { ascending: true, nullsFirst: true })
    );

    for (const publish of publishes) {
      // Rate-limit Instagram posts: min 60s between posts, max 48/24h per account
      if (publish.platform === 'instagram') {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentPosts } = await supabase
          .from('publishes')
          .select('updated_at')
          .eq('social_account_id', publish.social_account_id)
          .eq('platform', 'instagram')
          .eq('status', 'done')
          .gte('updated_at', since24h)
          .order('updated_at', { ascending: false });

        if ((recentPosts?.length ?? 0) >= 48) {
          console.log(`[worker] Instagram rate limit: ${recentPosts!.length} posts in last 24h, skipping.`);
          // Release the claim back to pending
          await supabase.from('publishes').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', publish.id);
          continue;
        }

        const lastPost = recentPosts?.[0];
        if (lastPost) {
          const secondsSinceLast = (Date.now() - new Date(lastPost.updated_at).getTime()) / 1000;
          if (secondsSinceLast < 60) {
            console.log(`[worker] Instagram cooldown: last post ${Math.round(secondsSinceLast)}s ago, waiting...`);
            await supabase.from('publishes').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', publish.id);
            continue;
          }
        }
      }

      publishSem.run(() => processPublish(supabase, publish)).catch(() => {});
    }
  }
}

async function main() {
  console.log('[worker] Starting ClipAI worker...');
  console.log(`[worker] Concurrency: ${JOB_CONCURRENCY} jobs, ${CUT_CONCURRENCY} cuts, ${PUBLISH_CONCURRENCY} publishes`);
  const supabase = getClient();

  while (true) {
    try {
      await poll(supabase);
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
