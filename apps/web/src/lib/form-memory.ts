// ═══════════════════════════════════════════════════════════
// Formalar xotirasi: oxirgi tanlangan qiymatlar (bo'lim, to'lov usuli, modda …)
// keyingi safar o'zi turadi. Faqat shu brauzerda; saqlab bo'lmasa — shunchaki eslanmaydi.
// ═══════════════════════════════════════════════════════════

const PREFIX = 'korxona_form_';

export function recallForm<T extends object>(key: string): Partial<T> {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function rememberForm<T extends object>(key: string, values: Partial<T>): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(values));
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}