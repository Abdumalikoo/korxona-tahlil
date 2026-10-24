// Umumiy yordamchilar (common/period, common/money, common/excel) avvalgi nusxalar bilan AYNAN bir xil ishlaydi.
// Avvalgi nusxalar shu yerga o'zgarishsiz ko'chirilgan va minglab tasodifiy qiymatda solishtiriladi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const { monthsBetween, monthSpan, monthLabel } = require('../dist/common/period');
const { somToTiyin } = require('../dist/common/money');
const { cellValue } = require('../dist/common/excel/cells');

// ───── Avvalgi nusxalar (o'zgarishsiz) ─────
const OLD = {
  // bulk-delete.service.ts
  bulk(a, b) { const out = []; let [y, m] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); let guard = 0; while ((y < by || (y === by && m <= bm)) && guard++ < 60) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } } return out; },
  // regional-desk.service.ts
  desk(from, to) { const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number); for (let guard = 0; guard < 240 && (y < ty || (y === ty && m <= tm)); guard++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; },
  // unit-lease.service.ts
  lease(from, to) { const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/; if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new Error('format'); if (from > to) throw new Error('order'); const out = []; let [y, m] = from.split('-').map(Number); for (;;) { const p = `${y}-${String(m).padStart(2, '0')}`; out.push(p); if (p === to) break; if (out.length > 24) throw new Error('max'); m += 1; if (m > 12) { m = 1; y += 1; } } return out; },
  // unit-lease parseAmount
  amountLease(v) { if (v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '-') return 0n; if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null; const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null; },
  // unit-payroll parseAmount
  amountPayroll(v) { const isBlank = (x) => x === null || x === undefined || String(x).trim() === ''; if (isBlank(v)) return 0n; if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null; const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null; },
  // unit-bank parseAmount
  amountBank(v) { const text = (x) => (x === null || x === undefined ? '' : x instanceof Date ? x.toISOString() : String(x)).trim(); if (v === null || v === undefined || text(v) === '') return 0n; if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null; const n = Number(text(v).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null; },
  // unit-lease cellValue (Date tekshiruvisiz)
  cellLease(value) { if (value && typeof value === 'object') { const r = value; if ('result' in r) return r.result; if ('text' in r) return r.text; if ('richText' in r && Array.isArray(r.richText)) return r.richText.map((p) => p.text).join(''); if ('formula' in r) return null; } return value; },
  // unit-entries / unit-bank cellValue
  cellEntries(value) { if (value && typeof value === 'object' && !(value instanceof Date)) { const r = value; if ('result' in r) return r.result; if ('text' in r) return r.text; if ('richText' in r && Array.isArray(r.richText)) return r.richText.map((p) => p.text).join(''); if ('formula' in r) return null; } return value; },
};

const res = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.message ? 'xato' : 'xato' }; } };
const same = (a, b, what) => assert.deepStrictEqual(res(a), res(b), what);
let seed = 20261025;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const period = () => {
  const r = rnd();
  if (r < 0.75) return `${2015 + Math.floor(rnd() * 15)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}`;
  return pick(['', 'abc', '2026-13', '2026-00', '2026-3', '2026-03-15', '20261-01', '2026', '-', ' 2026-03', '2026-1', '1999-12']);
};

(async () => {
  // ───── Oylar ─────
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    const a = period();
    const b = rnd() < 0.3 ? a : period();
    same(() => OLD.bulk(a, b), () => monthSpan(a, b, 60), `bulk ${a}..${b}`);
    same(() => OLD.desk(a, b), () => monthSpan(a, b, 240), `desk ${a}..${b}`);
    const l1 = res(() => OLD.lease(a, b));
    const l2 = res(() => monthsBetween(a, b));
    assert.deepStrictEqual(Boolean(l1.err), Boolean(l2.err), `lease xato ${a}..${b}`);
    if (!l1.err) assert.deepStrictEqual(l1.ok, l2.ok, `lease ${a}..${b}`);
    n++;
  }
  assert.deepStrictEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.throws(() => monthsBetween('2024-01', '2026-02'), /24 oy/);
  assert.strictEqual(monthLabel('2026-03'), 'Mart 2026');
  console.log(`  ✓ oylar: ${n * 3} ta solishtiruv — avvalgi uch nusxa bilan aynan bir xil`);

  // ───── Pul ─────
  const vals = [null, undefined, '', ' ', '-', ' - ', 0, 1, 1.005, 12345.67, -5, NaN, Infinity, '1 234,56', '1 234,56', '1,234.5', '12.3.4', 'abc', '0', '-0', ' 7 ', new Date('2026-03-01T00:00:00Z'), true, false, 1e15, '1e3', '0x10', [], {}];
  for (let i = 0; i < 20000; i++) vals.push(rnd() < 0.5 ? Math.round(rnd() * 1e9) / 100 : `${Math.floor(rnd() * 1e6)}${pick([',', '.', ''])}${Math.floor(rnd() * 100)}`.replace(/\B(?=(\d{3})+(?!\d))/g, pick(['', ' ', ' '])));
  for (const v of vals) {
    same(() => OLD.amountLease(v), () => somToTiyin(v, { dashIsZero: true }), `ijara ${String(v)}`);
    same(() => OLD.amountPayroll(v), () => somToTiyin(v), `ish haqi ${String(v)}`);
    same(() => OLD.amountBank(v), () => somToTiyin(v), `bank ${String(v)}`);
  }
  console.log(`  ✓ pul: ${vals.length * 3} ta solishtiruv — ijara, ish haqi va bank nusxalari bilan aynan bir xil`);

  // ───── Excel katagi ─────
  const cells = [null, undefined, 0, 5, 'matn', '', true, new Date('2026-01-01'), { result: 7, formula: 'A1' }, { formula: 'A1' }, { sharedFormula: 'A1' }, { text: 'havola', hyperlink: 'x' }, { richText: [{ text: 'a' }, { text: 'b' }] }, { richText: 'yo\'q' }, { error: '#N/A' }, {}, { result: null, formula: 'X' }];
  for (const c of cells) {
    same(() => OLD.cellLease(c), () => cellValue(c), `ijara katak ${JSON.stringify(c)}`);
    same(() => OLD.cellEntries(c), () => cellValue(c), `kiritish katak ${JSON.stringify(c)}`);
  }
  console.log('  ✓ Excel katagi: ijara, kiritish va bank nusxalari bilan aynan bir xil');

  // ───── Modullar endi bir-biridan import qilmaydi ─────
  const fs = require('fs');
  const path = require('path');
  for (const f of ['unit-payroll/unit-payroll.service.ts', 'unit-entries/unit-entries.service.ts', 'unit-bank/unit-bank.service.ts', 'expense-policy/unit-policy.service.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../src/modules', f), 'utf8');
    assert.ok(!/from '\.\.\/unit-lease\/unit-lease\.service'/.test(src), `${f} — unit-lease xizmatiga bog'liq emas`);
  }
  console.log('OK t-common-helpers');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});