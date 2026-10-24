// ═══════════════════════════════════════════════════════════
// Hamma API testlari: node test/run-all.js   (avval: API build — dist/ papka kerak)
//  • test/t-*.js     — soxta (xotiradagi) baza bilan, tez;
//  • test/pg/pg-*.js — haqiqiy PostgreSQL bilan; faqat TEST_DATABASE_URL berilsa
//                      (baza nomida «test» bo'lishi shart — ishlab chiqarish bazasiga tegmaydi).
// Python xizmatini talab qiladigan testlar RUN_PY_TESTS=1 bo'lsa ishlaydi.
// Natija: har test OK/FAIL/SKIP, oxirida jami; xato bo'lsa chiqish kodi 1.
// ═══════════════════════════════════════════════════════════
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const dist = path.join(here, '..', 'dist');
if (!fs.existsSync(path.join(dist, 'modules')) && !fs.existsSync(path.join(dist, 'src', 'modules'))) {
  console.error("dist/ topilmadi — avval API'ni build qiling (pnpm --filter api build)");
  process.exit(1);
}
const NEEDS_PY = new Set(['t-hudud-reja.js']);
const only = process.argv.slice(2);
const files = [
  ...fs.readdirSync(here).filter((f) => /^t-.*\.js$/.test(f)).sort().map((f) => path.join(here, f)),
  ...(fs.existsSync(path.join(here, 'pg')) ? fs.readdirSync(path.join(here, 'pg')).filter((f) => /^pg-.*\.js$/.test(f)).sort().map((f) => path.join(here, 'pg', f)) : []),
].filter((f) => !only.length || only.some((o) => f.includes(o)));

const res = { ok: [], fail: [], skip: [] };
const t0 = Date.now();
for (const f of files) {
  const name = path.relative(here, f);
  if (NEEDS_PY.has(path.basename(f)) && process.env.RUN_PY_TESTS !== '1') {
    res.skip.push(`${name} (Python xizmati kerak — RUN_PY_TESTS=1)`);
    continue;
  }
  if (name.startsWith('pg') && !process.env.TEST_DATABASE_URL) {
    res.skip.push(`${name} (TEST_DATABASE_URL yo'q)`);
    continue;
  }
  const s = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: path.join(here, '..'), encoding: 'utf8', timeout: 180_000, env: process.env });
  const ms = Date.now() - s;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0 && /^SKIP/m.test(out) && !/^OK/m.test(out)) res.skip.push(name);
  else if (r.status === 0) res.ok.push(name);
  else {
    res.fail.push(name);
    console.log(`\n✗ ${name} (${ms} ms)\n${out.split('\n').filter((l) => l.length < 400).slice(-25).join('\n')}`);
    continue;
  }
  console.log(`✓ ${name} (${ms} ms)`);
}
console.log(`\nJami: ${res.ok.length} o'tdi, ${res.fail.length} xato, ${res.skip.length} o'tkazildi — ${Math.round((Date.now() - t0) / 1000)} s`);
for (const s of res.skip) console.log(`  o'tkazildi: ${s}`);
if (res.fail.length) {
  console.log(`  xato: ${res.fail.join(', ')}`);
  process.exit(1);
}