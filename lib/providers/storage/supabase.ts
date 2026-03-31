import { createClient } from '@supabase/supabase-js';
import { StorageProvider } from './types';

const BUCKET = 'clips';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  return createClient(url, key);
}

export class SupabaseStorageProvider implements StorageProvider {
  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const client = getClient();

    const { error } = await client.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType, upsert: true });

    if (error) throw new Error(`Supabase upload falhou: ${error.message}`);

    const { data } = client.storage.from(BUCKET).getPublicUrl(key);
    return data.publicUrl;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const client = getClient();
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

    const { data: folders } = await client.storage.from(BUCKET).list('', { limit: 1000 });
    if (!folders) return 0;

    let deleted = 0;
    for (const folder of folders) {
      if (folder.created_at && folder.created_at < cutoff) {
        const { data: files } = await client.storage.from(BUCKET).list(folder.name);
        if (files?.length) {
          const paths = files.map(f => `${folder.name}/${f.name}`);
          await client.storage.from(BUCKET).remove(paths);
          deleted += paths.length;
        }
      }
    }
    return deleted;
  }
}
