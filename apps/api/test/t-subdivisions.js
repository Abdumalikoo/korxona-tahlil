// 1C «Подразделения» kodlari ma'lumotnomasi: unikal kalitlar, ota bo'limlar, joy merosi, takroriy kod (5.9).
const assert = require('assert');
const { SUBDIVISIONS, resolveSubdivision, normalizeSubdivisionCode } = require('../dist/common/structure/subdivisions');

const ids = SUBDIVISIONS.map((x) => x.id);
assert.strictEqual(new Set(ids).size, ids.length, 'id unikal');
for (const x of SUBDIVISIONS) {
  if (x.parentId) assert.ok(ids.includes(x.parentId), `ota bor: ${x.id}`);
  if (x.parentId && x.code === x.id) assert.ok(x.code.startsWith(x.parentId + '.'), `kod otasi ichida: ${x.code}`);
}
assert.deepStrictEqual(SUBDIVISIONS.filter((x) => !x.parentId).map((x) => x.code), ['1', '2', '3', '4', '5', '6']);

assert.strictEqual(normalizeSubdivisionCode('1.14.3.1. Quyoshli xonadon'), '1.14.3.1');
assert.strictEqual(normalizeSubdivisionCode(' 5.2.'), '5.2');
assert.strictEqual(normalizeSubdivisionCode('Tax free'), null);

const q = resolveSubdivision('1.14.3.1. Quyoshli xonadon');
assert.strictEqual(q.status, 'FOUND');
assert.deepStrictEqual(q.path.map((x) => x.code), ['1', '1.14', '1.14.3', '1.14.3.1']);
assert.deepStrictEqual(q.target, { unit: 'CENTER' }, 'Markazdan meros');
assert.deepStrictEqual(resolveSubdivision('1.18.1').target, { unit: 'BUXGALTERIYA' }, '1.18 — Buxgalteriya xizmatlari');
assert.deepStrictEqual(resolveSubdivision('5.2').target, { unit: 'TAX_FREE', regionCode: 6 });
assert.deepStrictEqual(resolveSubdivision('5.1').target, { unit: 'TAX_FREE' });
assert.deepStrictEqual(resolveSubdivision('4.2').target, { unit: 'FERMER', level: 'TUMAN' });
assert.deepStrictEqual(resolveSubdivision('6').target, { unit: 'MARKSHEYDER' });
assert.strictEqual(resolveSubdivision('7.1').status, 'NOT_FOUND');

// 5.9 — 1C da ikki marta
assert.strictEqual(resolveSubdivision('5.9').status, 'AMBIGUOUS');
assert.strictEqual(resolveSubdivision('5.9. Tax Free Namangan').subdivision.name, 'Tax Free Namangan');
assert.strictEqual(resolveSubdivision('5.9', 'Urganch').target.regionCode, 33);
console.log('OK t-subdivisions');
