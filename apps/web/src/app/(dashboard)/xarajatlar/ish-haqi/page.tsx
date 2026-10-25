'use client';

import { PayrollUploadPage } from '@/features/payroll/payroll-upload-page';

/** Xarajatlar › Ish haqi — vedomost (PINFL + summa) yoki soliq hisobotining o'zi */
export default function PayrollPage() {
  return <PayrollUploadPage mode="vedomost" />;
}