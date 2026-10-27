// Ish haqi tarkibi bo'yicha HAMMA xodimni bo'limlarga joylashtirish: oldindan ko'rish va saqlash (shu oy joyi).
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { CompositionPlaceService } = require('../dist/modules/salary-composition/salary-composition.place');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.department.push({ id: 'd1', name: 'Call markaz', isActive: true }, { id: 'd2', name: 'AUP', isActive: true }, { id: 'd3', name: 'Tax free bo‘limi', isActive: true });
  T.user.push({ id: 'u1', fullName: 'Admin' });
  const emp = (pinfl, fullName, departmentId) => ({ pinfl, fullName, departmentId, regionCode: 0 });
  T.employee.push(emp('10000000000001', 'Namuna A', 'd2'), emp('10000000000002', 'Namuna B', 'd1'), emp('10000000000003', 'Namuna C', 'd2'), emp('10000000000004', 'Namuna D', 'd2'));
  T.salaryCompositionBatch.push({ id: 'sb1', period: '2026-01', cancelledAt: null, createdAt: new Date() });
  T.setting.push({
    key: 'salary.composition.place.2026-01',
    value: {
      batchId: 'sb1',
      at: '',
      depts: { '10000000000001': 'Call markaz', '10000000000002': 'Call markaz', '10000000000003': 'Noma’lum bo‘lim', '10000000000004': 'Call markaz' },
      fixes: { '10000000000004': { pinfl: '10000000000004', fullName: 'Namuna D', deptName: 'x', departmentId: 'd2', departmentName: 'AUP', unit: 'CENTER', fromUnit: 'CENTER', fromDepartmentId: 'd2', fromDepartmentName: 'AUP', moveIds: [], source: 'MANUAL', at: '', by: '' } },
    },
  });
  const regrouped = [];
  const units = {
    link: async (u) => ({ departments: u === 'TAX_FREE' ? [{ id: 'd3', selected: true }] : [] }),
    unitsAt: async (pins) => new Map(pins.map((p) => [p, 'CENTER'])),
    uploadedIn: async () => new Map(),
    allMoves: async () => [],
  };
  const svc = new CompositionPlaceService(db.client, { log: async () => null }, units, { regroup: async (p) => regrouped.push(p) });

  const pv = await svc.syncPreview('2026-01');
  assert.strictEqual(pv.hasTarkib, true);
  assert.deepStrictEqual(pv.items.map((i) => [i.fullName, i.from, i.to]), [['Namuna A', 'Markaz › AUP', 'Markaz › Call markaz']], 'faqat farqi borlar; B — joyida; D — qo‘lda tanlangan');
  assert.strictEqual(pv.manual, 1);
  assert.deepStrictEqual(pv.unmapped, [{ name: 'Noma’lum bo‘lim', count: 1 }]);
  assert.strictEqual(T.setting.find((s) => s.key === 'salary.composition.place.2026-01').value.fixes['10000000000001'], undefined, "ko'rishda saqlanmaydi");

  const r = await svc.syncApply('2026-01', 'u1');
  assert.strictEqual(r.fixed, 1);
  const fixes = T.setting.find((s) => s.key === 'salary.composition.place.2026-01').value.fixes;
  assert.strictEqual(fixes['10000000000001'].departmentId, 'd1', 'A — shu oy Call markazda');
  assert.strictEqual(fixes['10000000000004'].source, 'MANUAL', 'qo‘lda tanlangani qoldi');
  assert.deepStrictEqual(regrouped, ['2026-01'], 'ish haqi qayta guruhlandi');
  assert.strictEqual((await svc.syncPreview('2026-01')).items.length, 0, 'qayta bosilsa — o‘zgarish yo‘q');
  console.log('OK t-composition-sync');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
