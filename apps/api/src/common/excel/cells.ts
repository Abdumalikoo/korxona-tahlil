import type ExcelJS from 'exceljs';

/**
 * Excel katagi qiymati: formula — saqlangan natijasi (natijasiz formula — bo'sh), giperhavola — matni,
 * formatlangan matn — oddiy matn, sana — o'zi. (Avval ijara, kiritish va bank yuklashlarida alohida nusxa edi.)
 */
export function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const r = value as unknown as Record<string, unknown>;
    if ('result' in r) return r.result;
    if ('text' in r) return r.text;
    if ('richText' in r && Array.isArray(r.richText)) return (r.richText as { text: string }[]).map((p) => p.text).join('');
    if ('formula' in r) return null;
  }
  return value;
}