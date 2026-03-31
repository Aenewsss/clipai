import { getSupabaseClient } from '@/lib/supabase';
import { StorageProvider } from './types';

const BUCKET = 'clips';

export class SupabaseStorageProvider implements StorageProvider {
  private async ensureBucket(): Promise<void> {
    const client = getSupabaseClient();
    const { data: buckets } = await client.storage.listBuckets();
    const exists = buckets?.some(b => b.name === BUCKET);
    if (!exists) {
      const { error } = await client.storage.createBucket(BUCKET, { public: true });
      if (error) throw new Error(`Falha ao criar bucket: ${error.message}`);
    }
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const client = getSupabaseClient();

    await this.ensureBucket();

    const { error } = await client.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType, upsert: true });

    if (error) throw new Error(`Supabase upload falhou: ${error.message}`);

    const { data } = client.storage.from(BUCKET).getPublicUrl(key);
    return data.publicUrl;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const client = getSupabaseClient();
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
