import { expect, test, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════
// Asosiy sahifalar: ochiladi, brauzerda JS xatosi yo'q, API 5xx qaytarmaydi, asosiy elementlar ko'rinadi.
// Faqat ochish va bosish — hech narsa saqlanmaydi, o'chirilmaydi.
// ═══════════════════════════════════════════════════════════

/** Sahifa xatolarini yig'ish: JS istisno va API'ning 5xx javoblari */
function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`JS: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`API ${r.status()}: ${new URL(r.url()).pathname}`);
  });
  return errors;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  // Kirish sahifasiga qaytarilmadi (token ishladi)
  await expect(page).not.toHaveURL(/\/kirish/);
  await expect(page.getByText(/Application error|Unhandled Runtime Error/)).toHaveCount(0);
}

test('Bosh sahifa', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Bosh sahifa' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [url, title] of [
  ['/xarajatlar/bank-kochirma', 'Xarajatlar'],
  ['/daromadlar/bank-kochirma', 'Daromadlar'],
] as const) {
  test(`Bank ko'chirmasi: ikki yorliq — ${url}`, async ({ page }) => {
    const errors = watch(page);
    await open(page, url);
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
    const upload = page.getByRole('button', { name: 'Yuklash', exact: true });
    const analysis = page.getByRole('button', { name: 'Tahlil va saqlash', exact: true });
    await expect(upload).toBeVisible();
    await expect(analysis).toBeVisible();
    await upload.click();
    await expect(page.getByText(/ko‘chirmasini shu yerga tashlang/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Shablon \(23106\)/ })).toBeVisible();
    await analysis.click();
    await expect(page.getByText(/saqlanmagan|Oyma-oy/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("Daromadlar › Qo'mita mablag'lari: ko'chirmadan yuklash va qo'lda kiritish", async ({ page }) => {
  const errors = watch(page);
  await open(page, '/daromadlar/qomita');
  await expect(page.getByText("Bank ko'chirmasidan yuklash")).toBeVisible();
  await expect(page.getByRole('button', { name: /Fayl tanlash/ })).toBeVisible();
  // Qo'lda kiritish oynasi ochiladi va yopiladi (saqlanmaydi)
  await page.getByRole('button', { name: '+ Ajratma kiritish' }).click();
  await expect(page.getByText("Qo'mita ajratmasi").first()).toBeVisible();
  await page.getByRole('button', { name: 'Bekor' }).click();
  expect(errors).toEqual([]);
});

test('3802: Qoplash va qoldiq — sarf (hovuz va shartnomalar)', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/3802');
  await expect(page.getByText('3802 hovuzi').first()).toBeVisible();
  await expect(page.getByText('Yig‘ma qoldiq').or(page.getByText("Yig'ma qoldiq")).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("3802: bo'limlar — Shtatlar, oylik, Nazorat zanjiri", async ({ page }) => {
  const errors = watch(page);
  await open(page, '/3802');
  await page.getByRole('tab', { name: 'Shtatlar', exact: true }).click();
  await expect(page.getByText('Oladigan shtatlar (3802)').first()).toBeVisible();
  await expect(page.getByText('Olmaydigan shtatlar').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Har oylik real bajarilgan ishlar', exact: true }).click();
  await expect(page.getByText(/Qabul qilingan oylar|Hali hech qaysi oy/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Nazorat zanjiri', exact: true }).click();
  await expect(page.getByText('Farq chegarasi:')).toBeVisible();
  // Oy tafsiloti: halqalar ochiladi
  const link = page.getByRole('button', { name: /Vedomost ↔ Ish haqi tarkibi/ });
  if (await link.count()) {
    await link.first().click();
    await expect(page.getByRole('button', { name: /Farqlar \(/ }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Xarajatlar › Internet', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/xarajatlar/internet');
  await expect(page.getByRole('heading', { name: 'Internet' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Manba chati ochiladi', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/chat');
  await expect(page.getByText(/Manba chati|chat kodi/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});
