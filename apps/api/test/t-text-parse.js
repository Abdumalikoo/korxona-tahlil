// Excel o'qish yordamchilari: matn ko'rinishidagi summa va kirill → lotin. TEST MA'LUMOTLARI SUN'IY.
const assert = require('assert');
const { parseAmount, latinize } = require('../dist/common/text/parse');

// Summa: ajratgichlar o'zi aniqlanadi
const cases = [
  [1234.5, 1234.5],
  ['1 234 567', 1234567],
  ['1 234 567,89', 1234567.89],
  ['1,234,567', 1234567],
  ['1,234,567.89', 1234567.89],
  ['1.234.567', 1234567],
  ['1.234.567,89', 1234567.89],
  ['12,5', 12.5],
  ['12.5', 12.5],
  ["12 345 so'm", 12345],
  ['12 345 сум', 12345],
  ['(1 500)', -1500],
  ['-250,75', -250.75],
  ['', null],
  ['abc', null],
  ['1,2,3', null],
  ['1.2.3', null],
  [null, null],
];
for (const [input, want] of cases) assert.strictEqual(parseAmount(input), want, `parseAmount(${JSON.stringify(input)})`);

// Kirill va aralash yozuv — lotindagidek solishtiriladi
assert.strictEqual(latinize('Андижон вилояти'), 'andijon viloyati');
assert.strictEqual(latinize('Аndijon v.'), 'andijon v.', 'kirill «А» + lotin');
assert.strictEqual(latinize('Фарғона'), "farg'ona");
assert.strictEqual(latinize('Қорақалпоғистон'), "qoraqalpog'iston");
assert.strictEqual(latinize('Тошкент шаҳри'), 'toshkent shahri');
assert.strictEqual(latinize('Toshkent'), 'toshkent', 'lotin o‘zgarmaydi');

console.log('t-text-parse: OK');
