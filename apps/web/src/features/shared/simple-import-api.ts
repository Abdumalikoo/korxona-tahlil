import { api, getToken, type ApiResponse } from '@/lib/api';

export type ImportKind = 'expense' | 'income';

export interface SimpleRow {
  rowIndex: number;
  name: string;
  amountTiyin: string;
}

export interface SimpleImportResult {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: { rowIndex: number; reason: string }[];
  totalTiyin: string;
  rows: SimpleRow[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Bo'sh shablonni yuklab oladi */
export async function downloadSimpleTemplate(kind: ImportKind): Promise<void> {
  const token = getToken();

  const response = await fetch(`${BASE}/simple-import/template/${kind}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Shablonni yuklab bo\u2018lmadi');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'shablon.xlsx';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

/** Faylni tahlil qiladi — hali saqlanmaydi */
export async function analyzeSimpleFile(file: File): Promise<SimpleImportResult> {
  const token = getToken();

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/simple-import/analyze`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    let message = 'Faylni tahlil qilib bo\u2018lmadi';
    try {
      const parsed = (await response.json()) as {
        error?: { message?: string | string[] };
      };
      const raw = parsed.error?.message;
      message = Array.isArray(raw) ? (raw[0] ?? message) : (raw ?? message);
    } catch {
      // JSON emas
    }
    throw new Error(message);
  }

  const result = (await response.json()) as ApiResponse<SimpleImportResult>;
  return result.data;
}

export const simpleImportApi = {
  commit: (kind: ImportKind, rows: SimpleRow[]) =>
    api.post<ApiResponse<{ created: number; totalTiyin: string }>>(
      `/simple-import/commit/${kind}`,
      { rows },
    ),
};
