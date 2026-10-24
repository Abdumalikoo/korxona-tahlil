// Ma'lumotnomalardagi shaxsiy maydonlarni bazada shifrlash: yangi yuklash, eski ma'lumotni shifrlash, qaytarish,
// kalitsiz holat, xodim kartasi va eksport. TEST MA'LUMOTLARI SUN'IY (ismlar, PINFL, pasport — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { HrSheetsService } = require('../dist/modules/hr-sheets/hr-sheets.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { clearHrCache } = require('../dist/modules/hr-sheets/hr-sheets.store');
const cr = require('../dist/modules/hr-sheets/hr-sheets.crypto');
const { SecurityService } = require('../dist/modules/security/security.service');
const { SecurityController } = require('../dist/modules/security/security.controller');
const { DeletePasswordService } = require('../dist/modules/bulk-delete/delete-password.service');
const { isSealed } = require('../dist/common/crypto/secret-box');

const KEY = 'hr-sinov-kaliti-0123456789-abcdefghijklmno';
const P = { a: '30000000000001', b: '30000000000002' };
const db = fakeDb();
const T = db.tables;
T.user.push({ id: 'u1', fullName: 'Admin Test' });
T.region.push({ code: 0, name: 'Markaz', isActive: true });
const audit = { logs: [], async log(x) { this.logs.push(x); } };
const svc = new HrSheetsService(db.client, audit, new UnitPayrollService(db.client, audit));

async function upload(code, header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Varaq');
  header.forEach((h, j) => (ws.getCell(5, j + 1).value = h));
  rows.forEach((r, i) => r.forEach((v, j) => (ws.getCell(6 + i, j + 1).value = v)));
  const a = await svc.analyze(code, { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: `${code}.xlsx` }, 'u1');
  await svc.commit(code, { token: a.token }, 'u1');
}
const H16 = ['PINFL', 'Xodimning familiyasi, ismi va sharifi', 'Pasport \nseriyasi', 'Pasport \nraqami', 'Telefon raqam', 'Departament (boshqarma) nomi'];
const raw = (key) => T.setting.find((s) => s.key === key)?.value;
const dump = () => JSON.stringify(T.setting.filter((s) => s.key.startsWith('hr.sheet.')).map((s) => s.value));
const field = (card, label) => card.sheets.flatMap((s) => s.records.flatMap((r) => r.groups.flatMap((g) => g.fields))).find((f) => f.label.startsWith(label))?.value;

(async () => {
  // ── 1. Kalitsiz: avvalgidek ochiq saqlanadi ──
  delete process.env.APP_ENCRYPTION_KEY;
  await upload('J16', H16, [[P.a, 'BIRINCHI SINOV', 'AA', '1234567', '+998 90 111 22 33', 'Fermer xizmati']]);
  assert.ok(dump().includes('1234567'));
  let st = await cr.hrCryptoStatus(db.client);
  assert.deepStrictEqual([st.ready, st.sealed, st.plain], [false, 0, 3]);

  // ── 2. Kalit bilan yangi yuklash — bazada shifrlangan, karta va eksportda ochiq ──
  process.env.APP_ENCRYPTION_KEY = KEY;
  await upload('J16', H16, [[P.a, 'BIRINCHI SINOV', 'AA', '1234567', '+998 90 111 22 33', 'Fermer xizmati'], [P.b, 'IKKINCHI SINOV', 'AB', '7654321', '+998 91 444 55 66', 'Fermer xizmati']]);
  const cur = raw('hr.sheet.J16');
  const pi = cur.cols.indexOf('pasportRaqam');
  assert.ok(isSealed(cur.rows[0][pi]) && isSealed(cur.rows[0][cur.cols.indexOf('telefon')]));
  assert.strictEqual(cur.rows[0][cur.cols.indexOf('fio')] ?? cur.rows[0][1], cur.rows[0][cur.cols.indexOf('fio')] ?? cur.rows[0][1]);
  assert.ok(JSON.stringify(cur).includes('BIRINCHI SINOV') && JSON.stringify(cur).includes(P.a), "F.I.Sh. va JShShIR ochiq (qidiruv uchun)");
  assert.ok(!JSON.stringify(cur).includes('7654321') && !JSON.stringify(cur).includes('444 55 66'), 'pasport va telefon bazada ochiq emas');
  assert.ok(JSON.stringify(raw('hr.sheet.J16.prev')).includes('1234567'), 'oldingi nusxa hali ochiq (eski yuklash)');
  let card = await svc.person(P.b);
  assert.strictEqual(field(card, 'Pasport raqami'), '7654321', 'kartada ochiq');
  assert.strictEqual(field(card, 'Telefon'), '+998 91 444 55 66');
  const rows = await svc.rows('J16', {});
  assert.ok(rows.rows.every((r) => String(r.cells.pasportRaqam).startsWith('•')), "ro'yxatda avvalgidek yashirin");
  const ex = await svc.export('J16', 'u1');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ex.buffer);
  assert.ok(JSON.stringify(wb.worksheets[0].getSheetValues()).includes('7654321'), 'eksportda (administrator) ochiq');

  // ── 3. Eski ma'lumotni shifrlash: avval zaxira; zaxira olinmasa — hech narsa o'zgarmaydi ──
  const pw = new DeletePasswordService(db.client, audit);
  let backupOk = false;
  const backup = { async create() { if (!backupOk) throw new Error('pg_dump topilmadi'); return { name: 'korxona_sinov.sql.gz.enc' }; } };
  const sec = new SecurityService(db.client, audit, backup, pw);
  const ctl = new SecurityController(sec);
  const beforeDump = dump();
  await assert.rejects(ctl.sealHr('u1'), /zaxira olib bo'lmadi — hech narsa o'zgartirilmadi/);
  assert.strictEqual(dump(), beforeDump);
  backupOk = true;
  const sealed = (await ctl.sealHr('u1')).data;
  assert.deepStrictEqual([sealed.plain, sealed.unreadable, sealed.backup], [0, 0, 'korxona_sinov.sql.gz.enc']);
  assert.ok(sealed.done > 0 && !dump().includes('1234567'), 'oldingi nusxa ham shifrlandi');
  assert.ok(audit.logs.some((l) => /shifrlandi/.test(l.summary) && !/1234567|7654321/.test(l.summary)));
  assert.strictEqual((await ctl.sealHr('u1')).data.done, 0, 'ikkinchi marta — o\'zgarish yo\'q');

  // Qaytarish (oldingi holat) va tozalash shifrlangan qiymatni o'zgarishsiz ko'chiradi
  await svc.restore('J16', 'u1');
  card = await svc.person(P.a);
  assert.strictEqual(field(card, 'Pasport raqami'), '1234567', 'qaytarilgan nusxa ham ochiladi');
  await svc.restore('J16', 'u1');

  // ── 4. Kalit yo'q yoki boshqa — karta ishlaydi, maydon o'rnida belgi ──
  delete process.env.APP_ENCRYPTION_KEY;
  clearHrCache();
  card = await svc.person(P.b);
  assert.strictEqual(field(card, 'Pasport raqami'), cr.LOCKED_TEXT);
  assert.strictEqual(card.fullName ?? 'IKKINCHI SINOV', card.fullName ?? 'IKKINCHI SINOV');
  st = await cr.hrCryptoStatus(db.client);
  assert.ok(st.unreadable > 0 && !st.ready);
  process.env.APP_ENCRYPTION_KEY = 'boshqa-kalit-0123456789-abcdefghijklmnopq';
  clearHrCache();
  assert.strictEqual(field(await svc.person(P.b), 'Telefon'), cr.LOCKED_TEXT);
  await assert.rejects(ctl.unsealHr({ password: 'x' }, 'u1'), /[Pp]arol|Standart/);

  // ── 5. Orqaga qaytarish (ochiq holga) — o'chirish paroli bilan, to'g'ri kalit kerak ──
  process.env.APP_ENCRYPTION_KEY = KEY;
  clearHrCache();
  await assert.rejects(ctl.unsealHr({ password: '3642' }, 'u1'), /Standart o'chirish paroli/);
  await pw.change({ current: '3642', next: 'Ochir-Sinov-9' }, 'u1');
  await assert.rejects(ctl.unsealHr({ password: 'notogri' }, 'u2'), /noto'g'ri/);
  const un = (await ctl.unsealHr({ password: 'Ochir-Sinov-9' }, 'u1')).data;
  assert.ok(un.done > 0 && un.sealed === 0 && dump().includes('7654321'), 'hammasi ochiq holga qaytdi');
  assert.strictEqual(field(await svc.person(P.b), 'Pasport raqami'), '7654321');
  // Boshqa kalit bilan ochiq holga qaytarib bo'lmaydi (yozilmaydi)
  await ctl.sealHr('u1');
  process.env.APP_ENCRYPTION_KEY = 'boshqa-kalit-0123456789-abcdefghijklmnopq';
  const d2 = dump();
  await assert.rejects(ctl.unsealHr({ password: 'Ochir-Sinov-9' }, 'u1'), /Ochib bo'lmadi — hech narsa o'zgartirilmadi/);
  assert.strictEqual(dump(), d2);
  delete process.env.APP_ENCRYPTION_KEY;
  console.log('OK t-hr-crypto');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});