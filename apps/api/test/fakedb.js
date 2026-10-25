// Juda soddalashtirilgan Prisma o'xshashi (faqat ombor xizmati ishlatadigan so'rovlar uchun)
let seq = 0;
const id = () => `id${++seq}`;
const REL = {
  stockDoc: { lines: { model: 'stockLine', fk: 'docId', many: true }, moves: { model: 'assetMove', fk: 'docId', many: true } },
  stockLine: { item: { model: 'stockItem', key: 'itemId' }, doc: { model: 'stockDoc', key: 'docId' } },
  asset: { item: { model: 'stockItem', key: 'itemId' }, moves: { model: 'assetMove', fk: 'assetId', many: true } },
  assetMove: { asset: { model: 'asset', key: 'assetId' }, doc: { model: 'stockDoc', key: 'docId' } },
  employee: { region: { model: 'region', key: 'regionCode', target: 'code' }, department: { model: 'department', key: 'departmentId' }, district: { model: 'district', key: 'districtId' } },
  payrollEntry: { batch: { model: 'payrollBatch', key: 'batchId' }, employee: { model: 'employee', key: 'employeePinfl', target: 'pinfl' } },
  employeeResult: { batch: { model: 'resultBatch', key: 'batchId' } },
  leaseAccrual: { lease: { model: 'lease', key: 'leaseId' } },
  lease: { terms: { model: 'leaseTerm', fk: 'leaseId', many: true } },
  payrollBatch: { entries: { model: 'payrollEntry', fk: 'batchId', many: true } },
  employeeLocation: { region: { model: 'region', key: 'regionCode', target: 'code' }, district: { model: 'district', key: 'districtId' } },
  stockItem: {},
  reaction: { items: { model: 'reactionItem', fk: 'reactionId', many: true }, assignees: { model: 'reactionAssignee', fk: 'reactionId', many: true }, controls: { model: 'controlRule', fk: 'reactionId', many: true } },
  auditLog: { user: { model: 'user', key: 'userId' } },
  vehicleRecord: { vehicle: { model: 'vehicle', key: 'vehicleId' } },
  expense: { category: { model: 'category', key: 'categoryCode', target: 'code' }, createdBy: { model: 'user', key: 'createdById' }, region: { model: 'region', key: 'regionCode', target: 'code' }, district: { model: 'district', key: 'districtId' }, department: { model: 'department', key: 'departmentId' } },
  income: { category: { model: 'incomeCategory', key: 'categoryCode', target: 'code' }, createdBy: { model: 'user', key: 'createdById' }, department: { model: 'department', key: 'departmentId' }, region: { model: 'region', key: 'regionCode', target: 'code' }, district: { model: 'district', key: 'districtId' } },
  purchase: { lines: { model: 'purchaseLine', fk: 'purchaseId', many: true }, payments: { model: 'purchasePayment', fk: 'purchaseId', many: true }, receipts: { model: 'goodsReceipt', fk: 'purchaseId', many: true } },
  purchaseLine: { purchase: { model: 'purchase', key: 'purchaseId' } },
  purchaseRequest: { lines: { model: 'purchaseRequestLine', fk: 'requestId', many: true }, purchases: { model: 'purchase', fk: 'requestId', many: true } },
  goodsReceipt: { lines: { model: 'goodsReceiptLine', fk: 'receiptId', many: true }, purchase: { model: 'purchase', key: 'purchaseId' } },
  task: { reminders: { model: 'taskReminder', fk: 'taskId', many: true } },
  taskReminder: { task: { model: 'task', key: 'taskId' } },
  cashReport: { lines: { model: 'cashReportLine', fk: 'reportId', many: true } },
  cashReportLine: { report: { model: 'cashReport', key: 'reportId' }, account: { model: 'cashAccount', key: 'accountId' } },
  stockCount: { lines: { model: 'stockCountLine', fk: 'countId', many: true }, assets: { model: 'stockCountAsset', fk: 'countId', many: true } },
  salaryCompositionItem: { row: { model: 'salaryCompositionRow', key: 'rowId' }, batch: { model: 'salaryCompositionBatch', key: 'batchId' } },
  salaryCompositionRow: { batch: { model: 'salaryCompositionBatch', key: 'batchId' }, items: { model: 'salaryCompositionItem', many: true, fk: 'rowId' } },
};
const DEFAULTS = {
  payrollEntry: () => ({ baseTiyin: 0n, bonusTiyin: 0n, vacationTiyin: 0n, deductionTiyin: 0n, taxTiyin: 0n, totalTiyin: 0n, workedDays: null, deletedAt: null }),
  leaseMonthClose: () => ({ closedAt: new Date(Date.now() + seq), cancelledAt: null, leaseCount: 0, totalTiyin: 0n, closedById: null }),
  lease: () => ({ deletedAt: null, districtId: null, departmentId: null, airportName: null, endPeriod: null, vatIncluded: true }),
  stockDoc: () => ({ deletedAt: null, createdAt: new Date(Date.now() + seq), fromDepartmentId: null, fromRegionCode: null, fromHolderPinfl: null, fromHolderName: null }),
  asset: () => ({ status: 'IN_STOCK', departmentId: null, regionCode: null, holderPinfl: null, holderName: null, note: null, serialNo: null, createdAt: new Date() }),
  assetMove: () => ({ createdAt: new Date(Date.now() + seq), fromDepartmentId: null, fromRegionCode: null, fromHolderPinfl: null, fromHolderName: null, toDepartmentId: null, toRegionCode: null, toHolderPinfl: null, toHolderName: null, docId: null, note: null }),
  stockItem: () => ({ isActive: true, group: null, minQty: null, note: null }),
  stockLine: () => ({ expenseId: null, note: null }),
  stockCount: () => ({ status: 'DRAFT', writeOffDocId: null, receiptDocId: null, finishedAt: null, finishedById: null, chairman: null, commission: null, note: null }),
  stockCountLine: () => ({ actualQty: null, bookQty: null, priceTiyin: null }),
  stockCountAsset: () => ({ found: null }),
  postalPayment: () => ({ deletedAt: null, documentNo: null, note: null }),
  expense: () => ({ deletedAt: null }),
  fixedAsset: () => ({ deletedAt: null, mode: 'BALANCE', lifeOverridden: false, regionCode: null, departmentId: null, assetId: null, inventoryNo: null, expenseId: null, disposedAt: null, disposeReason: null, note: null, createdById: null, updatedAt: new Date() }),
  vehicle: () => ({ deletedAt: null, note: null, fuelCardNo: null, bodyType: null, fleetGroup: null, isActive: true, departmentId: null, regionCode: 0, initialOdometerKm: null }),
  vehicleRecord: () => ({ deletedAt: null, importKey: null, odometerKm: null }),
  purchase: () => ({ status: 'OPEN', feeTiyin: 0n, totalTiyin: 0n, deletedAt: null, deliveredAt: null, feeExpenseId: null, supplierId: null }),
  purchasePayment: () => ({ deletedAt: null }),
  purchaseRequest: () => ({ status: 'NEW', rejectReason: null }),
  goodsReceipt: () => ({ status: 'PENDING', rejectReason: null, decidedAt: null, decidedById: null, stockDocId: null }),
  supplier: () => ({ isActive: true }),
  task: () => ({ status: 'OPEN', description: null, doneAt: null, doneById: null, updatedAt: new Date() }),
  taskReminder: () => ({ sentAt: null, attempts: 0, error: null }),
  telegramLink: () => ({ linkedAt: new Date(), username: null, firstName: null }),
  stockDocSign: () => ({ status: 'PENDING', method: null, signature: null, signedAt: null, signedIp: null, signedAgent: null, attempts: 0, lockedUntil: null, archive: null, archiveName: null, telegram: null, updatedAt: new Date() }),
  cashAccount: () => ({ isActive: true, isHeader: false, code: null, number: null, parentId: null, rollupId: null, sums: [], balanceRule: 'ADD', updatedAt: new Date() }),
  cashReport: () => ({ note: null, updatedAt: new Date(Date.now() + seq) }),
  user: () => ({ failedAttempts: 0, tokenVersion: 0, lockedUntil: null, lastLoginAt: null, isActive: true, mustChangePin: false, loginCode: null, pinHash: null }),
};
function make(db) {
  const t = db.tables;
  const get = (model, row, rel) => {
    const r = REL[model]?.[rel];
    if (!r) return undefined;
    if (r.many) return t[r.model].filter((x) => x[r.fk] === row.id);
    return t[r.model].find((x) => x[r.target ?? 'id'] === row[r.key]) ?? null;
  };
  const cmp = (v, cond) => {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return (v instanceof Date && cond instanceof Date) ? v.getTime() === cond.getTime() : v === cond;
    if ('in' in cond) return cond.in.includes(v);
    if ('notIn' in cond) { if (cond.notIn.includes(v)) return false; const { notIn, ...rest } = cond; return Object.keys(rest).length ? cmp(v, rest) : true; }
    if ('not' in cond) return !cmp(v, cond.not);
    if ('equals' in cond) return cond.mode === 'insensitive' ? String(v ?? '').toLowerCase() === String(cond.equals).toLowerCase() : v === cond.equals;
    if ('startsWith' in cond) return typeof v === 'string' && v.startsWith(cond.startsWith);
    if ('contains' in cond) return typeof v === 'string' && v.toLowerCase().includes(String(cond.contains).toLowerCase());
    let ok = true;
    if ('gte' in cond) ok = ok && v >= cond.gte;
    if ('lte' in cond) ok = ok && v <= cond.lte;
    if ('gt' in cond) ok = ok && v > cond.gt;
    if ('lt' in cond) ok = ok && v < cond.lt;
    return ok;
  };
  const match = (model, row, where) => {
    if (!where) return true;
    return Object.entries(where).every(([k, c]) => {
      if (k === 'OR') return c.some((w) => match(model, row, w));
      if (k === 'AND') return c.every((w) => match(model, row, w));
      if (k === 'NOT') return !match(model, row, c);
      // Murakkab unikal kalit: countId_itemId: { countId, itemId }
      if (k.includes('_') && c && typeof c === 'object' && !(k in row)) return Object.entries(c).every(([kk, vv]) => row[kk] === vv);
      const r = REL[model]?.[k];
      if (r) {
        if (r.many) return c.some ? get(model, row, k).some((x) => match(r.model, x, c.some)) : true;
        const target = get(model, row, k);
        return target ? match(r.model, target, c) : false;
      }
      return cmp(row[k] === undefined ? null : row[k], c);
    });
  };
  const shape = (model, row, args) => {
    if (!row) return row;
    const out = { ...row };
    const inc = args?.include ?? null;
    const sel = args?.select ?? null;
    if (inc) for (const [k, v] of Object.entries(inc)) {
      const r = REL[model][k];
      const val = get(model, row, k);
      out[k] = r.many ? val.map((x) => shape(r.model, x, v === true ? null : v)) : shape(r.model, val, v === true ? null : v);
    }
    if (sel) {
      const o = {};
      for (const [k, v] of Object.entries(sel)) {
        const r = REL[model]?.[k];
        if (r) { const val = get(model, row, k); o[k] = r.many ? val.map((x) => shape(r.model, x, v === true ? null : v)) : shape(r.model, val, v === true ? null : v); }
        else o[k] = row[k];
      }
      return o;
    }
    return out;
  };
  const order = (rows, orderBy) => {
    const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...rows].sort((a, b) => {
      for (const o of list) { const [k, dir] = Object.entries(o)[0]; const x = a[k], y = b[k]; if (x === y) continue; const r = x > y ? 1 : -1; return dir === 'desc' ? -r : r; }
      return 0;
    });
  };
  const api = (model) => ({
    findMany: async (a = {}) => { let rows = t[model].filter((r) => match(model, r, a.where)); rows = order(rows, a.orderBy); if (a.distinct) { const seen = new Set(); rows = rows.filter((r) => { const k = a.distinct.map((d) => r[d]).join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); } if (a.skip) rows = rows.slice(a.skip); if (a.take) rows = rows.slice(0, a.take); return rows.map((r) => shape(model, r, a)); },
    findFirst: async (a = {}) => (await api(model).findMany({ ...a, take: 1 }))[0] ?? null,
    findUnique: async (a) => shape(model, t[model].find((r) => match(model, r, a.where)) ?? null, a),
    count: async (a = {}) => t[model].filter((r) => match(model, r, a.where)).length,
    create: async (a) => {
      const data = { ...a.data };
      const nested = [];
      for (const [k, v] of Object.entries(data)) {
        const r = REL[model]?.[k];
        if (r && r.many && v && v.create) { nested.push([r, v.create]); delete data[k]; }
      }
      const row = { id: id(), ...(DEFAULTS[model]?.() ?? {}), createdAt: new Date(Date.now() + seq), ...data };
      for (const k of Object.keys(row)) if (row[k] === undefined) row[k] = null;
      t[model].push(row);
      for (const [r, list] of nested) for (const c of list) await api(r.model).create({ data: { ...c, [r.fk]: row.id } });
      return shape(model, row, a);
    },
    update: async (a) => { const row = t[model].find((r) => match(model, r, a.where)); if (!row) throw new Error('not found ' + model); for (const [k, v] of Object.entries(a.data)) {
      // Prisma munosabati: { connect: { id|code } } / { disconnect: true } → tashqi kalit maydoni
      if (v && typeof v === 'object' && !(v instanceof Date) && ('connect' in v || 'disconnect' in v)) {
        if (v.connect) { const [ck, cv] = Object.entries(v.connect)[0]; row[k + ck[0].toUpperCase() + ck.slice(1)] = cv; }
        else { for (const f of [k + 'Id', k + 'Code']) if (f in row) row[f] = null; }
        continue;
      }
      row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] ?? 0) + v.increment : v;
    } return shape(model, row, a); },
    updateMany: async (a) => { const rows = t[model].filter((r) => match(model, r, a.where)); rows.forEach((r) => Object.assign(r, a.data)); return { count: rows.length }; },
    delete: async (a) => { const i = t[model].findIndex((r) => match(model, r, a.where)); const [row] = t[model].splice(i, 1); return row; },
    createMany: async (a) => { for (const d of a.data) t[model].push({ ...(DEFAULTS[model]?.() ?? {}), createdAt: new Date(), id: d.id ?? id(), ...d }); return { count: a.data.length }; },
    deleteMany: async (a) => { const before = t[model].length; t[model] = t[model].filter((r) => !match(model, r, a.where)); if (model === 'asset') { const ids = new Set(t.asset.map((x) => x.id)); t.assetMove = t.assetMove.filter((m) => ids.has(m.assetId)); } return { count: before - t[model].length }; },
    upsert: async (a) => { const row = t[model].find((r) => match(model, r, a.where)); if (row) { Object.assign(row, a.update); return row; } return api(model).create({ data: a.create }); },
    aggregate: async (a) => { const rows = t[model].filter((r) => match(model, r, a.where)); const out = {}; if (a._count) out._count = { _all: rows.length }; if (a._min) { out._min = {}; for (const k of Object.keys(a._min)) out._min[k] = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === null || v < m ? v : m), null); } if (a._max) { out._max = {}; for (const k of Object.keys(a._max)) out._max[k] = rows.length ? rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === null || v > m ? v : m), null) : null; } if (a._sum) { out._sum = {}; for (const k of Object.keys(a._sum)) out._sum[k] = rows.length ? rows.reduce((s, r) => s + (r[k] ?? (typeof s === 'bigint' ? 0n : 0)), typeof rows[0][k] === 'bigint' ? 0n : 0) : null; } return out; },
    groupBy: async (a) => { const keys = a._sum ? Object.keys(a._sum) : ['priceTiyin']; const groups = new Map(); for (const r of t[model].filter((x) => match(model, x, a.where))) { const k = a.by.map((b) => r[b]).join('|'); const g = groups.get(k) ?? { ...Object.fromEntries(a.by.map((b) => [b, r[b]])), _count: { _all: 0 }, _sum: Object.fromEntries(keys.map((kk) => [kk, null])) }; g._count._all += 1; for (const kk of keys) { const v = r[kk]; if (v !== null && v !== undefined) g._sum[kk] = g._sum[kk] === null ? v : g._sum[kk] + v; } groups.set(k, g); } return [...groups.values()]; },
  });
  const client = {
    // Interaktiv tranzaksiya: xato bo'lsa — jadvallar avvalgi holatiga qaytadi (Prisma kabi)
    $transaction: async (fn) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      const snap = {};
      for (const k of Object.keys(t)) snap[k] = structuredClone(t[k]);
      try {
        return await fn(db.client);
      } catch (e) {
        for (const k of Object.keys(snap)) { t[k].length = 0; t[k].push(...snap[k]); }
        throw e;
      }
    },
  };
  for (const m of Object.keys(t)) client[m] = api(m);
  // Keyin qo'shilgan jadvallar (testda T.yangi = []) ham ishlasin
  return new Proxy(client, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && Array.isArray(t[k]) ? (o[k] = api(k)) : undefined) });
}
module.exports = function fakeDb() {
  const db = { tables: { stockItem: [], stockDoc: [], stockLine: [], asset: [], assetMove: [], expense: [], category: [], department: [], region: [], employee: [], user: [], auditLog: [], stockCount: [], stockCountLine: [], stockCountAsset: [], postalPayment: [], vehicle: [], vehicleRecord: [], income: [], incomeCategory: [], payrollBatch: [], setting: [], task: [], supplier: [], purchase: [], purchaseLine: [], purchasePayment: [], purchaseRequest: [], purchaseRequestLine: [], goodsReceipt: [], goodsReceiptLine: [], taskReminder: [], telegramLink: [], telegramLinkCode: [], district: [], employeeLocation: [], payrollEntry: [], cashAccount: [], cashReport: [], cashReportLine: [], regionalPeriodClose: [], analysisEvent: [], serviceTariff: [], employeeSalary: [], expenseBudget: [], overheadRule: [], overheadDriverValue: [], forecastRun: [], kpiTarget: [], kpiTargetLog: [], resultBatch: [], employeeResult: [], leaseAccrual: [], lease: [], leaseTerm: [], leaseMonthClose: [], reaction: [], reactionItem: [], reactionAssignee: [], controlRule: [], fixedAsset: [], salaryComponent: [], salaryCompositionBatch: [], salaryCompositionRow: [], salaryCompositionItem: [], importBatch: [], stockDocSign: [] } };
  db.client = make(db);
  return db;
};