'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ActTemplateEditor } from '@/features/warehouse/act-template';

// Ombor › Dalolatnoma shabloni: berish, qaytarish, o'tkazish, hisobdan chiqarish, kirim — bitta shablon, hududlar uchun alohida.
export default function ActTemplatePage() {
  return (
    <>
      <PageHeader title="Dalolatnoma shabloni" description="Berish, qaytarib olish, boshqaga o'tkazish va hisobdan chiqarish dalolatnomalari qanday chiqishi" />
      <ActTemplateEditor />
    </>
  );
}