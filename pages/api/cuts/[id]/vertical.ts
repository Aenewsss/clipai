import type { NextApiRequest, NextApiResponse } from 'next';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getSupabaseClient } from '@/lib/supabase';
import { generateVerticalClip } from '@/lib/vertical-crop';
import { createStorageProvider } from '@/lib/providers/storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query as { id: string };
  const supabase = getSupabaseClient();

  const { data: cut, error } = await supabase
    .from('cuts')
    .select('id, job_id, status, clip_url, clip_vertical_url')
    .eq('id', id)
    .single();

  if (error || !cut) return res.status(404).json({ error: 'Corte não encontrado' });
  if (cut.status !== 'done' || !cut.clip_url) return res.status(400).json({ error: 'Corte ainda não está pronto' });
  if (cut.clip_vertical_url) return res.status(200).json({ clip_vertical_url: cut.clip_vertical_url });

  const uid = randomBytes(6).toString('hex');
  const inputPath = join(tmpdir(), `clipai_vert_in_${uid}.mp4`);
  const outputPath = join(tmpdir(), `clipai_vert_out_${uid}.mp4`);

  try {
    const dlRes = await fetch(cut.clip_url);
    if (!dlRes.ok) throw new Error(`Falha ao baixar clip: ${dlRes.status}`);
    await writeFile(inputPath, Buffer.from(await dlRes.arrayBuffer()));

    await generateVerticalClip(inputPath, outputPath);

    const verticalBuffer = await readFile(outputPath);
    const storage = createStorageProvider();
    const verticalKey = `${cut.job_id}/vertical_${uid}.mp4`;
    const verticalUrl = await storage.upload(verticalKey, verticalBuffer, 'video/mp4');

    await supabase.from('cuts').update({
      clip_vertical_url: verticalUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    return res.status(200).json({ clip_vertical_url: verticalUrl });
  } finally {
    unlink(inputPath).catch(() => {});
    unlink(outputPath).catch(() => {});
  }
}
