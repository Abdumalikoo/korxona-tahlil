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
  // Ma'lumot yuklanmagan bo'lsa — «0» va «100%» emas, «yuklanmagan» / «—»
  await expect(page.getByText('Rentabellik').first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [url, title] of [
  ['/xarajatlar/bank-kochirma', "Bank ko'chirmasi"],
  ['/daromadlar/bank-kochirma', "Bank ko'chirmasi"],
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
    // Nomma-nom (vipiska kabi) ko'rinishi — ko'chirma saqlangan bo'lsa (faqat ko'rish, hech narsa bosilmaydi)
    const rowsToggle = page.getByRole('button', { name: 'Nomma-nom (vipiska kabi)' });
    if (await rowsToggle.count()) {
      await rowsToggle.click();
      await expect(page.getByText(/^Nomma-nom · /).first()).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'ИНН' })).toBeVisible();
      await page.getByRole('button', { name: 'Guruhlab' }).click();
    }
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
  // O'zbekcha oy tanlagich (brauzerning ruscha maydoni emas)
  await expect(page.getByRole('combobox', { name: 'Dan: oy' })).toBeVisible();
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

test("Hisobotlar › Bo'limlar bo'yicha: ko'rish, tuman, Excel", async ({ page }) => {
  const errors = watch(page);
  await open(page, '/hisobotlar');
  await expect(page.getByRole('tab', { name: "Bo'limlar bo'yicha" })).toBeVisible();
  // Markaz bo'limi — ekranda
  await page.getByRole('button', { name: "Ekranda ko'rish" }).click();
  await expect(page.getByText('Oyma-oy').first()).toBeVisible();
  await expect(page.getByText('Xarajat nimaga ketdi').first()).toBeVisible();
  // Hudud va tuman tanlash
  await page.getByRole('tab', { name: 'Hudud' }).click();
  await expect(page.getByLabel('Tuman')).toBeVisible();
  // Excel yuklab olinadi
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(errors).toEqual([]);
});

test("KPI: baholash stoli (administrator) va Yig'ma KPI", async ({ page }) => {
  const errors = watch(page);
  await open(page, '/kpi/ish-stoli?b=MARKSHEYDER');
  await expect(page.getByText(/Marksheyderlik xizmati/).first()).toBeVisible();
  // Xodim tanlanadi → mezonlar (faqat ko'rish, tanlov bosilmaydi — hech narsa saqlanmaydi)
  const first = page.locator('ul li button').filter({ hasText: /baholanmagan|\d/ }).first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByRole('tab', { name: /Rag'batlantiruvchi/ })).toBeVisible();
    await expect(page.getByText(/yangi mijoz/i).first()).toBeVisible();
    await page.getByRole('tab', { name: /Kamaytiruvchi/ }).click();
    await expect(page.getByText(/xatolikka yo'l qo'yilishi/).first()).toBeVisible();
  }
  await open(page, '/yigma-kpi');
  for (const d of ['Marksheyder', 'Tax free', 'Axborot xizmati']) await expect(page.getByRole('heading', { name: d }).first()).toBeVisible();
  await expect(page.getByText("Bo'lim rahbarlari").first()).toBeVisible();
  await expect(page.getByText('Sinov rahbar — Marksheyder').or(page.getByText("Hali bo'lim rahbari yo'q")).first()).toBeVisible();
  // KPI demosini o'chirish: tasdiq so'zisiz tugma ishlamaydi (hech narsa o'chirilmaydi — «Bekor»)
  const demo = page.getByRole('button', { name: "KPI demosini o'chirish" });
  await expect(demo).toBeVisible();
  if (await demo.isEnabled()) {
    await demo.click();
    await expect(page.getByRole('button', { name: "Hammasini o'chirish" })).toBeDisabled();
    await page.getByRole('textbox', { name: "Tasdiqlash so'zi" }).fill('ha');
    await expect(page.getByRole('button', { name: "Hammasini o'chirish" })).toBeDisabled();
    await page.getByRole('button', { name: 'Bekor', exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test("Rollar › KPI: bo'lim dashbordi va rol sahifasi", async ({ page }) => {
  const errors = watch(page);
  for (const [key, name] of [
    ['MARKSHEYDER', 'Marksheyder'],
    ['TAX_FREE', 'Tax free'],
    ['AXBOROT', 'Axborot xizmati'],
  ]) {
    await open(page, `/rollar/kpi/${key}`);
    // Sarlavha yuqori panelda ham, sahifa sarlavhasida ham bor — ko'rinadiganini olamiz
    await expect(page.getByText(`KPI: ${name}`, { exact: true }).locator('visible=true').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diqqat', exact: true }).locator('visible=true').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Baholash mezonlari', exact: true }).locator('visible=true').first()).toBeVisible();
  }
  // «Ish stoliga kirish» — rahbar ko'rinishida shu bo'lim stoli
  await page.getByRole('button', { name: /Ish stoliga kirish/ }).locator('visible=true').first().click();
  await expect(page).toHaveURL(/\/kpi\/ish-stoli\?b=AXBOROT/);
  expect(errors).toEqual([]);
});

test("Daromadlar › Hisobga olinmaydigan tushumlar: kiritish oynasi (saqlanmaydi)", async ({ page }) => {
  const errors = watch(page);
  await open(page, '/daromadlar/hisobga-olinmaydi');
  await expect(page.getByText(/daromad emas/).first()).toBeVisible();
  await expect(page.getByText('Oyma-oy').locator('visible=true').first()).toBeVisible();
  await page.getByRole('button', { name: '+ Tushum kiritish' }).click();
  await expect(page.getByRole('combobox', { name: /Turi/ })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Ustav fondini shakllantirish' })).toBeAttached();
  await page.getByRole('button', { name: 'Bekor' }).click();
  expect(errors).toEqual([]);
});
