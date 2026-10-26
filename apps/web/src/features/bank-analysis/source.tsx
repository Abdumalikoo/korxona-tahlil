'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { bankAnalysisApi, invoiceAnalysisApi, type AnalysisApi, type BankDir } from './api';

// ═══════════════════════════════════════════════════════════
// Tahlil manbai: bank ko'chirmasi yoki schyot-fakturalar — bir xil sahifa, API va yorliqlar farqi shu yerda.
// ═══════════════════════════════════════════════════════════

export type AnalysisSource = 'bank' | 'invoice';

export interface SourceCfg {
  source: AnalysisSource;
  api: AnalysisApi;
  dirLabel: Record<BankDir, string>;
  /** Bitta qator nomi: «to'lov» / «faktura qatori» */
  item: string;
  /** Guruh nomi: «o'xshash to'lovlar» / «o'xshash xizmatlar (kontragent + IKPU)» */
  groupsTitle: string;
}

export const SOURCES: Record<AnalysisSource, SourceCfg> = {
  bank: { source: 'bank', api: bankAnalysisApi, dirLabel: { OUT: 'Chiqim', IN: 'Kirim' }, item: "to'lov", groupsTitle: "O'xshash to'lovlar guruhlari" },
  invoice: { source: 'invoice', api: invoiceAnalysisApi, dirLabel: { OUT: 'Kiruvchi (xarajat)', IN: 'Chiquvchi (daromad)' }, item: 'faktura qatori', groupsTitle: "Kontragent va xizmat (IKPU) bo'yicha guruhlar" },
};

const Ctx = createContext<SourceCfg>(SOURCES.bank);

export function SourceProvider({ source, children }: { source: AnalysisSource; children: ReactNode }) {
  return <Ctx.Provider value={SOURCES[source]}>{children}</Ctx.Provider>;
}

export const useSource = () => useContext(Ctx);
