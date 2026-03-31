import { StorageProvider } from './types';
import { LocalStorageProvider } from './local';
import { SupabaseStorageProvider } from './supabase';

export function createStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || 'supabase';

  switch (provider) {
    case 'supabase':
      return new SupabaseStorageProvider();
    case 'local':
      return new LocalStorageProvider();
    default:
      throw new Error(`Storage provider desconhecido: "${provider}". Use "supabase" ou "local".`);
  }
}

export type { StorageProvider };
