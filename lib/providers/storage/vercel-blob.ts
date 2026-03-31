import { put, list, del } from '@vercel/blob';
import { StorageProvider } from './types';

export class VercelBlobProvider implements StorageProvider {
  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const blob = await put(key, buffer, { access: 'public', contentType });
    return blob.url;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    let deleted = 0;
    const cutoff = Date.now() - maxAgeMs;
    const { blobs } = await list();
    for (const blob of blobs) {
      if (new Date(blob.uploadedAt).getTime() < cutoff) {
        await del(blob.url);
        deleted++;
      }
    }
    return deleted;
  }
}
