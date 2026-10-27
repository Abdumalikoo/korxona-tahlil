// Shartnoma asosidagi xodimlar ish haqi — o'z hududi / Markaz bo'limiga (hududsiz «Shartnoma» guruhi yo'q).
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');

const svc = Object.create(PayrollService.prototype);
const g = (e, scope) => svc.groupOf(e, scope);
const reg = g({ employmentType: 'SHARTNOMA', regionCode: 5, departmentId: null, region: { name: 'Namuna viloyati' }, department: null }, 'ALL');
assert.deepStrictEqual([reg.key, reg.regionCode, reg.departmentId], ['region-5', 5, null], 'hudud shartnomachisi — o‘z hududiga');
const cen = g({ employmentType: 'SHARTNOMA', regionCode: 0, departmentId: 'd1', region: { name: 'Markaz' }, department: { name: 'AUP' } }, 'ALL');
assert.deepStrictEqual([cen.key, cen.regionCode, cen.departmentId], ['markaz-d1', 0, 'd1'], 'Markaz shartnomachisi — o‘z bo‘limiga');
const shtat = g({ employmentType: 'SHTAT', regionCode: 5, departmentId: null, region: { name: 'Namuna viloyati' }, department: null }, 'ALL');
assert.strictEqual(shtat.key, reg.key, 'shtat bilan bir xil');
assert.strictEqual(g({ employmentType: 'SHARTNOMA', regionCode: 5, departmentId: null, region: { name: 'N' }, department: null }, 'REGIONS').key, 'region-5');
// Eski yozuvlar (hududsiz) — qayta guruhlashda farq aniqlanadi va joyiga ko'chiriladi
assert.strictEqual(svc.expenseKey({ regionCode: null, departmentId: null }), 'shartnoma');
console.log('OK t-payroll-contract');
