// ═══════════════════════════════════════════════════════════
// Excel'dan o'qishda umumiy yordamchilar: kirill → lotin (nomlarni solishtirish uchun) va
// matn ko'rinishidagi summa («1 234 567,89», «1,234,567.89», «1.234.567», «12 345 so'm»).
// ═══════════════════════════════════════════════════════════

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu',
  я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h', і: 'i',
};

/** O'zbek kirill yozuvi → lotin (kichik harflarda); aralash yozuv («Аndijon» — kirill «А») ham to'g'rilanadi */
export function latinize(value: string): string {
  return Array.from(String(value ?? '').toLowerCase(), (ch) => CYR[ch] ?? ch).join('');
}

/**
 * Matn yoki son → son (summa). Ajratgichlar o'zi aniqlanadi:
 *  • nuqta ham, vergul ham bo'lsa — oxirgisi kasr, boshqasi minglik («1,234,567.89», «1.234.567,89»);
 *  • faqat vergul — «1,234,567» (3 xonali guruhlar) minglik, aks holda kasr («12,5»);
 *  • faqat nuqta — ikki va undan ko'p 3 xonali guruh («1.234.567») minglik, aks holda kasr («12.5»).
 * Bo'shliqlar (oddiy, bo'linmas, ingichka), «so'm / сум / UZS» olib tashlanadi; (123) — manfiy. Tushunarsiz — null.
 */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value)
    .toLowerCase()
    .replace(/so['ʻʼ‘’`]?m|сўм|сум|sum|uzs/g, '')
    .replace(/[\s    ]/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('');
    if (s.split(dec).length > 2) return null;
    s = s.replace(dec, '.');
  } else if (comma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.split(',').length === 2 ? s.replace(',', '.') : '';
  } else if (dot >= 0) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.split('.').join('');
    else if (s.split('.').length > 2) return null;
  }
  const n = Number(s);
  return s && Number.isFinite(n) ? sign * n : null;
}
