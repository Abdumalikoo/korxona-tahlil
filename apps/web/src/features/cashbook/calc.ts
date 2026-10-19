// ═══════════════════════════════════════════════════════════
// Kunlik ma'lumotnoma hisob-kitobi — sof funksiyalar (server va ekran bir xil hisoblaydi).
//
// Ustunlar (shablondagidek, «ming so'm»da ko'rinadi, ichida — tiyin):
//   ytd     — Yil boshidan (bugungacha, bugun kirmaydi)
//   mtd     — Oy boshidan (bugungacha)
//   refund  — Qaytarilgan pul mablag'lari
//   daily   — Kunlik tushum
//   balance — Sana holatiga qoldiq
// Bugun bilan birga (shablondagi J, K, L):
//   ytd + daily, mtd + daily, qoldiq ± kunlik (qator qoidasi bo'yicha).
// Jami qatorlar: `sums` ustunlari — `rollupId` orqali bog'langan qatorlar yig'indisi.
// ═══════════════════════════════════════════════════════════

export const CASH_COLUMNS = ['ytd', 'mtd', 'refund', 'daily', 'balance'] as const;
export type CashColumn = (typeof CASH_COLUMNS)[number];
export type CashValues = Record<CashColumn, bigint | null>;

export interface CalcAccount {
  id: string;
  rollupId: string | null;
  inputs: string[];
  sums: string[];
  balanceRule: string;
}

export interface CalcRow {
  values: CashValues;
  /** Bugun bilan birga: yil boshidan, oy boshidan, qoldiq */
  after: { ytd: bigint | null; mtd: bigint | null; balance: bigint | null };
}

export function emptyValues(): CashValues {
  return { ytd: null, mtd: null, refund: null, daily: null, balance: null };
}

/** null + null = null (bo'sh katak bo'sh qoladi), aks holda yig'indi */
export function addN(a: bigint | null, b: bigint | null): bigint | null {
  if (a === null && b === null) return null;
  return (a ?? 0n) + (b ?? 0n);
}

/**
 * Hamma qatorlarning yakuniy qiymatlari: kiritilgan ustunlar o'zidan, jami ustunlar — bolalaridan.
 * `input` — faqat kiritilgan qiymatlar (accountId → ustunlar).
 */
export function computeAll(accounts: CalcAccount[], input: Map<string, Partial<CashValues>>): Map<string, CalcRow> {
  const kids = new Map<string, CalcAccount[]>();
  for (const a of accounts) {
    if (!a.rollupId) continue;
    const list = kids.get(a.rollupId) ?? [];
    list.push(a);
    kids.set(a.rollupId, list);
  }
  const memo = new Map<string, CashValues>();
  const visiting = new Set<string>();

  const valueOf = (a: CalcAccount): CashValues => {
    const done = memo.get(a.id);
    if (done) return done;
    if (visiting.has(a.id)) return emptyValues(); // aylana bog'lanish — e'tiborsiz
    visiting.add(a.id);
    const own = input.get(a.id) ?? {};
    const v = emptyValues();
    for (const col of CASH_COLUMNS) {
      if (a.sums.includes(col)) {
        let total: bigint | null = null;
        for (const k of kids.get(a.id) ?? []) total = addN(total, valueOf(k)[col]);
        // Jami ham, o'z qiymati ham bo'lsa (masalan, qaytarilgan — asosiy hisobraqamda) — qo'shiladi
        v[col] = a.inputs.includes(col) ? addN(total, own[col] ?? null) : total;
      } else if (a.inputs.includes(col)) {
        v[col] = own[col] ?? null;
      }
    }
    visiting.delete(a.id);
    memo.set(a.id, v);
    return v;
  };

  const out = new Map<string, CalcRow>();
  for (const a of accounts) {
    const v = valueOf(a);
    out.set(a.id, { values: v, after: afterOf(a, v) });
  }
  return out;
}

/** Bugun bilan birga (ertangi kun boshidagi) qiymatlar */
export function afterOf(a: Pick<CalcAccount, 'balanceRule'>, v: CashValues): CalcRow['after'] {
  const balance =
    a.balanceRule === 'KEEP'
      ? v.balance
      : a.balanceRule === 'SUB'
        ? v.balance === null && v.daily === null
          ? null
          : (v.balance ?? 0n) - (v.daily ?? 0n)
        : addN(v.balance, v.daily);
  return { ytd: addN(v.ytd, v.daily), mtd: addN(v.mtd, v.daily), balance };
}

/**
 * Oldingi kundan keyingi kunning boshlang'ich qiymatlari (faqat kiritiladigan ustunlarda):
 *  • yil boshidan = oldingi yil boshidan + oldingi kunlik (yil almashsa — 0 dan);
 *  • oy boshidan = oldingi oy boshidan + oldingi kunlik (oy almashsa — 0 dan);
 *  • qoldiq (taklif) = oldingi qoldiq ± oldingi kunlik.
 */
export function carryForward(
  a: Pick<CalcAccount, 'inputs' | 'balanceRule'>,
  prev: Partial<CashValues> | undefined,
  prevDate: string,
  date: string,
): { ytd: bigint | null; mtd: bigint | null; balance: bigint | null } {
  const p: CashValues = { ...emptyValues(), ...(prev ?? {}) };
  const sameYear = prevDate.slice(0, 4) === date.slice(0, 4);
  const sameMonth = prevDate.slice(0, 7) === date.slice(0, 7);
  const after = afterOf(a, p);
  return {
    ytd: a.inputs.includes('ytd') ? (sameYear ? after.ytd : null) : null,
    mtd: a.inputs.includes('mtd') ? (sameMonth ? after.mtd : null) : null,
    balance: a.inputs.includes('balance') ? after.balance : null,
  };
}

/** Tiyin → «ming so'm» matni (3 kasr xonagacha, ortiqcha nollarsiz): 178917600 → "1 789,176" */
export function tiyinToThousands(v: bigint | null): string {
  if (v === null) return '';
  const neg = v < 0n;
  const abs = neg ? -v : v;
  // 1 ming so'm = 100 000 tiyin; 3 kasr xona — so'm aniqligi (qolgan tiyin yaxlitlanadi)
  const som = (abs + 50n) / 100n;
  const whole = som / 1000n;
  const frac = (som % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** «ming so'm» matni → tiyin: "1 789,176" → 178917600; bo'sh → null; xato → undefined */
export function thousandsToTiyin(raw: string): bigint | null | undefined {
  const s = String(raw ?? '')
    .replace(/[\s ']/g, '')
    .replace(',', '.');
  if (s === '' || s === '-') return null;
  if (!/^-?\d+(\.\d{0,3})?$/.test(s)) return undefined;
  const neg = s.startsWith('-');
  const [w, f = ''] = s.replace('-', '').split('.');
  const som = BigInt(w!) * 1000n + BigInt((f + '000').slice(0, 3));
  const t = som * 100n;
  return neg ? -t : t;
}