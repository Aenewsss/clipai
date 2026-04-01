import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { downloadYouTubeAudio } from '../lib/youtube-audio';
import { transcribeAudio } from '../lib/transcription';
import { analyzeTranscript } from '../lib/analyzer';
import { downloadAndCutClip } from '../lib/clip-cutter';
import { getVideoInfo } from '../lib/youtube';
import { createLLMProvider } from '../lib/providers/llm';
import { createTranscriptionProvider } from '../lib/providers/transcription';
import { createStorageProvider } from '../lib/providers/storage';
import { createSocialProvider } from '../lib/providers/social';
import { decryptToken, encryptToken } from '../lib/crypto';

const POLL_INTERVAL_MS = 5000;

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
    // 1. Get title
    await updateJob(supabase, id, { status: 'processing', step: 'downloading' });
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

  await supabase.from('cuts')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id);

  try {
    const { data: job } = await supabase.from('jobs').select('url').eq('id', job_id).single();
    if (!job) throw new Error('Job não encontrado');

    const storage = createStorageProvider();
    const result = await downloadAndCutClip(job.url, { start_time, end_time, title }, clip_index);

    const key = `${job_id}/${result.filename}`;
    const clipUrl = await storage.upload(key, result.buffer, 'video/mp4');

    await supabase.from('cuts').update({
      status: 'done', clip_url: clipUrl, updated_at: new Date().toISOString(),
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
  const { id, cut_id, social_account_id, platform } = publish;
  console.log(`[worker] Publishing cut ${cut_id} to ${platform}...`);

  await supabase.from('publishes')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id);

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
      .select('clip_url, title')
      .eq('id', cut_id)
      .single();

    if (!cut?.clip_url) throw new Error('Corte sem URL de vídeo');

    // Publish
    const socialProvider = createSocialProvider(platform);
    const result = await socialProvider.publish({
      videoUrl: cut.clip_url,
      title: cut.title,
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

async function poll(supabase: ReturnType<typeof getClient>) {
  // Process one analyze job at a time
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (jobs?.length) await processJob(supabase, jobs[0]);

  // Process one cut at a time
  const { data: cuts } = await supabase
    .from('cuts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (cuts?.length) await processCut(supabase, cuts[0]);

  // Process one publish at a time
  const { data: publishes } = await supabase
    .from('publishes')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (publishes?.length) await processPublish(supabase, publishes[0]);
}

async function main() {
  console.log('[worker] Starting ClipAI worker...');
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
