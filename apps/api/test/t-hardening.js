// Xavfsizlik 2c: so'rov tanasi chegaralari, summa chegarasi, Excel'ga formula kiritib bo'lmasligi,
// imzo IP manzili, cookie sessiya va CSRF tekshiruvi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { limitFor } = require('../dist/common/security/body-limits');
const { assertAmount, MAX_AMOUNT_TIYIN } = require('../dist/common/validation/amount');
const { txt } = require('../dist/modules/bplan/bplan.workbook');
const { clientIp } = require('../dist/modules/warehouse/warehouse.sign.controller');
const { csrfGuard, readCookie, AUTH_COOKIE, cookieToken } = require('../dist/common/security/auth-cookie');
const { CreateExpenseDto } = require('../dist/modules/expenses/dto/create-expense.dto');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

ok('tana chegarasi manzil bo\'yicha', () => {
  assert.strictEqual(limitFor('/api/auth/login', '10mb'), '16kb');
  assert.strictEqual(limitFor('/api/auth/code-login/', '10mb'), '16kb');
  assert.strictEqual(limitFor('/api/public/acts/x/sign', '10mb'), '2mb');
  assert.strictEqual(limitFor('/api/expenses', '10mb'), '10mb');
  assert.strictEqual(limitFor('/api/auth/login-x', '10mb'), '10mb');
});

ok('summa chegarasi (10 trillion so\'m)', () => {
  assert.strictEqual(assertAmount(MAX_AMOUNT_TIYIN), MAX_AMOUNT_TIYIN);
  assert.strictEqual(assertAmount(-MAX_AMOUNT_TIYIN), -MAX_AMOUNT_TIYIN);
  assert.throws(() => assertAmount(MAX_AMOUNT_TIYIN + 1n, '3-qator'), /3-qator: summa juda katta/);
  assert.throws(() => assertAmount(-MAX_AMOUNT_TIYIN - 1n), /juda katta/);
});

ok('DTO: juda katta summa rad etiladi', () => {
  const base = { categoryId: 'c1', date: '2026-01-15', description: 'Sinov' };
  const big = validateSync(plainToInstance(CreateExpenseDto, { ...base, amountTiyin: 2e15 }));
  assert.ok(big.some((e) => e.property === 'amountTiyin' && JSON.stringify(e.constraints).includes('juda katta')), JSON.stringify(big));
  const fine = validateSync(plainToInstance(CreateExpenseDto, { ...base, amountTiyin: 1e15 }));
  assert.ok(!fine.some((e) => e.property === 'amountTiyin'));
});

ok('Excel: foydalanuvchi matni formula bo\'lmaydi', () => {
  for (const s of ['=HYPERLINK("http://x","bos")', '+1+1', '-2+3', '@SUM(A1)', '\t=1']) {
    const v = txt(s);
    assert.ok(typeof v === 'object' && v.richText[0].text === s, s);
  }
  assert.strictEqual(txt('Oddiy nom'), 'Oddiy nom');
  assert.strictEqual(txt(''), '');
  assert.strictEqual(txt(null), null);
});

ok('imzo IP: faqat vositachi qo\'shgan oxirgi qiymat', () => {
  assert.strictEqual(clientIp('127.0.0.1', '1.1.1.1, 10.0.0.5'), '10.0.0.5');
  assert.strictEqual(clientIp('::ffff:127.0.0.1', '::ffff:192.168.1.7'), '192.168.1.7');
  assert.strictEqual(clientIp('203.0.113.9', '1.1.1.1'), '203.0.113.9', 'tashqaridan to\'g\'ridan-to\'g\'ri — sarlavhaga ishonilmaydi');
  assert.strictEqual(clientIp('127.0.0.1', '<script>'), '127.0.0.1');
  assert.strictEqual(clientIp('127.0.0.1', undefined), '127.0.0.1');
});

ok('cookie o\'qish', () => {
  const req = { headers: { cookie: `a=1; ${AUTH_COOKIE}=abc.def; b=2` } };
  assert.strictEqual(readCookie(req, AUTH_COOKIE), 'abc.def');
  assert.strictEqual(cookieToken(req), 'abc.def');
  assert.strictEqual(cookieToken({ headers: {} }) ?? null, null);
});

ok('CSRF: cookie bilan yozish — sarlavha shart', () => {
  const g = csrfGuard();
  const run = (req) => {
    let status = 200, body = null, nexted = false;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    g({ method: 'POST', headers: {}, ...req, headers: { ...(req.headers || {}) } }, res, () => { nexted = true; });
    return { status, body, nexted };
  };
  const ck = `${AUTH_COOKIE}=t`;
  assert.strictEqual(run({ headers: { cookie: ck } }).status, 403);
  assert.ok(run({ headers: { cookie: ck, 'x-requested-with': 'korxona' } }).nexted);
  assert.ok(run({ headers: { cookie: ck, authorization: 'Bearer t' } }).nexted, 'Bearer — cookie emas, CSRF xavfi yo\'q');
  assert.ok(run({ method: 'GET', headers: { cookie: ck } }).nexted, 'o\'qish — ruxsat');
  assert.ok(run({ headers: {} }).nexted, 'cookie yo\'q — oddiy tekshiruv (401) keyin');
});

console.log(`HARDENING OK (${n})`);