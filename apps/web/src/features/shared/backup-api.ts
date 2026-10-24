import { api, getToken, type ApiResponse } from '@/lib/api';

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  /** Shifrlangan (.sql.gz.enc) */
  encrypted?: boolean;
  /** Ikkinchi joyda nusxasi bormi (null — ikkinchi joy sozlanmagan) */
  mirrored?: boolean | null;
}

export interface BackupStats {
  count: number;
  totalBytes: number;
  lastBackup: string | null;
  retentionDays: number;
  directory: string;
  /** Yangi zaxiralar shifrlanadimi (serverda BACKUP_ENCRYPTION_KEY) */
  encryption?: boolean;
  lastEncrypted?: boolean | null;
  mirror?: { configured: boolean; directory: string | null; last: { ok: boolean; at: string } | null };
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Zaxira faylni yuklab oladi */
export async function downloadBackup(name: string): Promise<void> {
  const token = getToken();

  const response = await fetch(`${BASE}/backup/download/${encodeURIComponent(name)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Faylni yuklab bo\u2018lmadi');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export const backupApi = {
  list: () =>
    api.get<ApiResponse<{ files: BackupFile[]; stats: BackupStats }>>('/backup'),

  create: () => api.post<ApiResponse<BackupFile>>('/backup/create'),

  cleanup: () => api.post<ApiResponse<{ deleted: number }>>('/backup/cleanup'),
};