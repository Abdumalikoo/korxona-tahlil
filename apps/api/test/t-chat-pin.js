// Chat kodi: kirish (token), saqlash va yangi suhbat (har safar kod), sozlamalar, kutish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { ChatPinService } = require('../dist/modules/source-chat/chat-pin.service');
const { SourceChatController } = require('../dist/modules/source-chat/chat.controller');
const { SourceChatService } = require('../dist/modules/source-chat/chat.service');
const { HrSheetsService } = require('../dist/modules/hr-sheets/hr-sheets.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');

const db = fakeDb();
const T = db.tables;
T.user.push({ id: 'u1', fullName: 'Admin' }, { id: 'u2', fullName: 'Admin 2' });
const audit = { logs: [], async log(x) { this.logs.push(x); } };
const pin = new ChatPinService(db.client, audit);
const up = new UnitPayrollService(db.client, audit);
const chat = new SourceChatService(db.client, new HrSheetsService(db.client, audit, up), up);
const ctl = new SourceChatController(chat, pin);

(async () => {
  // Standart: 8020, hamma joyda so'raladi
  let cfg = await pin.config();
  assert.deepStrictEqual(cfg.require, { use: true, save: true, newChat: true });
  assert.strictEqual(cfg.isDefault, true);
  assert.strictEqual(cfg.ttlMinutes, 120);
  assert.strictEqual((await pin.status(undefined, 'u1')).unlocked, false);

  // Qulf: tokensiz — chat yopiq
  await assert.rejects(ctl.ask({ text: 'salom' }, undefined, 'u1'), /CHAT_LOCKED/);
  await assert.rejects(ctl.threads('u1', undefined, undefined), /CHAT_LOCKED/);
  await assert.rejects(pin.unlock('1111', 'u1'), /noto'g'ri \(4 ta/);

  // Standart kod hammaga ma'lum: u bilan kirib bo'lmaydi — faqat yangi kod o'rnatiladi
  assert.strictEqual((await pin.status(undefined, 'u1')).mustSetCode, true);
  await assert.rejects(pin.unlock('8020', 'u1'), /CHAT_SETUP/);
  await assert.rejects(pin.update({ currentCode: '8020', ttlMinutes: 30 }, 'u2'), /Avval standart koddan farqli/);
  await assert.rejects(pin.update({ currentCode: '0000', newCode: '582947' }, 'u2'), /noto'g'ri/);
  await assert.rejects(pin.update({ currentCode: '8020', newCode: '4321' }, 'u2'), /6–8/);
  await assert.rejects(pin.update({ currentCode: '8020', newCode: '123456' }, 'u2'), /juda oddiy/);
  await assert.rejects(pin.update({ currentCode: '8020', newCode: '777777' }, 'u2'), /juda oddiy/);
  await assert.rejects(pin.update({ currentCode: '8020', newCode: '582947', ttlMinutes: 2 }, 'u2'), /5–1440/);
  cfg = await pin.update({ currentCode: '8020', newCode: '582947' }, 'u2');
  assert.strictEqual(cfg.isDefault, false);
  assert.strictEqual((await pin.status(undefined, 'u1')).mustSetCode, false);
  await assert.rejects(pin.unlock('8020', 'u1'), /noto'g'ri/);

  const { token } = await pin.unlock('582947', 'u1');
  assert.ok(pin.tokenValid(token, 'u1'));
  assert.ok(!pin.tokenValid(token, 'u2'), 'boshqa foydalanuvchi uchun yaroqsiz');
  assert.ok(!pin.tokenValid(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'u1'), 'buzilgan token');
  assert.ok(!pin.tokenValid(`${Date.now() - 1000}.${token.split('.')[1]}`, 'u1'), 'muddati o\'tgan');
  assert.strictEqual((await pin.status(token, 'u1')).unlocked, true);

  // Yangi suhbat — kod bilan; mavjud suhbatda savol — kodsiz
  await assert.rejects(ctl.ask({ text: 'salom' }, token, 'u1'), /CHAT_CODE: Yangi suhbat/);
  const a = (await ctl.ask({ text: 'salom', code: '582947' }, token, 'u1')).data;
  assert.ok(a.threadId);
  const b = (await ctl.ask({ text: 'manbalar', threadId: a.threadId }, token, 'u1')).data;
  assert.strictEqual(b.threadId, a.threadId);
  await assert.rejects(ctl.create('u1', {}, token), /CHAT_CODE/);
  assert.ok((await ctl.create('u1', { code: '582947' }, token)).data.id);

  // Saqlash va Excel — kod bilan
  await assert.rejects(ctl.save('u1', { threadId: a.threadId, itemId: b.id }, token), /CHAT_CODE: Saqlash/);
  assert.ok((await ctl.save('u1', { threadId: a.threadId, itemId: b.id, code: '582947' }, token)).data.id);
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, send(x) { this.body = x; } };
  await assert.rejects(ctl.exportThread('u1', a.threadId, res, token, undefined), /CHAT_CODE/);
  await ctl.exportThread('u1', a.threadId, res, token, '582947');
  assert.ok(res.body && res.body.length > 500);

  // Sozlamalar: joriy kod bilan; kodni almashtirish; talablarni o'chirish
  await assert.rejects(pin.update({ currentCode: '582947', newCode: '582947' }, 'u2'), /farq qilsin/);
  cfg = await pin.update({ currentCode: '582947', newCode: '640318', require: { save: false }, ttlMinutes: 30 }, 'u2');
  assert.deepStrictEqual([cfg.isDefault, cfg.require.save, cfg.require.use, cfg.ttlMinutes], [false, false, true, 30]);
  await assert.rejects(pin.unlock('582947', 'u2'), /noto'g'ri/);
  assert.ok((await pin.unlock('640318', 'u2')).token);
  // saqlash endi kodsiz
  const c = (await ctl.ask({ text: 'nechta xodim bor', threadId: a.threadId }, token, 'u1')).data;
  assert.ok((await ctl.save('u1', { threadId: a.threadId, itemId: c.id }, token)).data.id);
  // Kirish talab qilinmasa — tokensiz ishlaydi
  await pin.update({ currentCode: '640318', require: { use: false } }, 'u2');
  assert.ok((await ctl.threads('u1', undefined, undefined)).data.length >= 1);
  assert.strictEqual((await pin.status(undefined, 'u1')).unlocked, true);

  // 5 marta noto'g'ri — kutish
  for (let i = 0; i < 4; i++) await assert.rejects(pin.unlock('9999', 'u3'), /noto'g'ri/);
  await assert.rejects(pin.unlock('9999', 'u3'), /5 daqiqa kuting/);
  await assert.rejects(pin.unlock('640318', 'u3'), /keyin urinib/);

  // Kod hech qayerda saqlanmaydi va logga chiqmaydi
  const stored = JSON.stringify(T.setting.find((s) => s.key === 'chat.pin').value);
  assert.ok(!stored.includes('640318') && !stored.includes('582947') && !stored.includes('8020'));
  assert.ok(!JSON.stringify(audit.logs.filter((l) => l.entity === 'chat_pin')).match(/640318|582947|8020|9999|1111/));

  // Token kaliti fayl yuklanganda emas, birinchi ishlatilganda o'qiladi (.env keyin yuklanadi)
  const src = require('fs').readFileSync(require.resolve('../dist/modules/source-chat/chat-pin.service'), 'utf8');
  assert.ok(!/^const SECRET/m.test(src) && /function signingKey/.test(src));
  console.log('OK t-chat-pin');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});