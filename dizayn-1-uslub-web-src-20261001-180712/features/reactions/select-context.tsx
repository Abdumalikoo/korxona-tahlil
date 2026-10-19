'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { markKey, type MarkItem } from './api';

// ═══════════════════════════════════════════════════════════
// Munosabat belgilash rejimi: nomlangan savatlar, butun dasturda umumiy.
// Savatlar brauzerda saqlanadi — sahifa almashsa yoki yangilansa ham yo'qolmaydi.
// ═══════════════════════════════════════════════════════════

export interface Basket {
  id: string;
  name: string;
  items: MarkItem[];
  createdAt: string;
}

interface State {
  active: boolean;
  baskets: Basket[];
  currentId: string | null;
}

interface SelectApi extends State {
  current: Basket | null;
  setActive: (active: boolean) => void;
  /** Yangi savat (nomi bilan) — u joriy bo'ladi */
  createBasket: (name: string) => Basket;
  renameBasket: (id: string, name: string) => void;
  removeBasket: (id: string) => void;
  selectBasket: (id: string) => void;
  isMarked: (item: Pick<MarkItem, 'kind' | 'filter'>) => boolean;
  /** Belgilash / olib tashlash (joriy savatda) */
  toggle: (item: MarkItem) => void;
  add: (item: MarkItem) => void;
  removeItem: (basketId: string, key: string) => void;
  clearBasket: (id: string) => void;
}

const STORAGE_KEY = 'korxona_munosabat_savat';
const EMPTY: State = { active: false, baskets: [], currentId: null };

const Context = createContext<SelectApi | null>(null);

function load(): State {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as State;
    if (!Array.isArray(parsed.baskets)) return EMPTY;
    return { active: Boolean(parsed.active), baskets: parsed.baskets, currentId: parsed.currentId ?? parsed.baskets[0]?.id ?? null };
  } catch {
    return EMPTY;
  }
}

function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function defaultName(count: number): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `Savat ${count + 1} · ${dd}.${mm}`;
}

export function ReactionSelectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setState(load());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Saqlab bo'lmasa ham ishlayveradi
    }
  }, [state, loaded]);

  const current = useMemo(() => state.baskets.find((b) => b.id === state.currentId) ?? null, [state]);

  const setActive = useCallback((active: boolean) => setState((s) => ({ ...s, active })), []);

  const createBasket = useCallback((name: string) => {
    const basket: Basket = { id: newId(), name: name.trim() || defaultName(0), items: [], createdAt: new Date().toISOString() };
    setState((s) => ({ ...s, baskets: [...s.baskets, { ...basket, name: name.trim() || defaultName(s.baskets.length) }], currentId: basket.id }));
    return basket;
  }, []);

  const renameBasket = useCallback((id: string, name: string) => {
    setState((s) => ({ ...s, baskets: s.baskets.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b)) }));
  }, []);

  const removeBasket = useCallback((id: string) => {
    setState((s) => {
      const baskets = s.baskets.filter((b) => b.id !== id);
      return { ...s, baskets, currentId: s.currentId === id ? (baskets[baskets.length - 1]?.id ?? null) : s.currentId };
    });
  }, []);

  const selectBasket = useCallback((id: string) => setState((s) => ({ ...s, currentId: id })), []);

  /** Joriy savat yo'q bo'lsa — avtomatik yaratiladi */
  const withCurrent = (s: State): [State, Basket] => {
    const existing = s.baskets.find((b) => b.id === s.currentId);
    if (existing) return [s, existing];
    const basket: Basket = { id: newId(), name: defaultName(s.baskets.length), items: [], createdAt: new Date().toISOString() };
    return [{ ...s, baskets: [...s.baskets, basket], currentId: basket.id }, basket];
  };

  const add = useCallback((item: MarkItem) => {
    setState((prev) => {
      const [s, basket] = withCurrent(prev);
      const key = markKey(item);
      if (basket.items.some((i) => markKey(i) === key)) return s;
      return { ...s, baskets: s.baskets.map((b) => (b.id === basket.id ? { ...b, items: [...b.items, item] } : b)) };
    });
  }, []);

  const toggle = useCallback((item: MarkItem) => {
    setState((prev) => {
      const [s, basket] = withCurrent(prev);
      const key = markKey(item);
      const has = basket.items.some((i) => markKey(i) === key);
      const items = has ? basket.items.filter((i) => markKey(i) !== key) : [...basket.items, item];
      return { ...s, baskets: s.baskets.map((b) => (b.id === basket.id ? { ...b, items } : b)) };
    });
  }, []);

  const removeItem = useCallback((basketId: string, key: string) => {
    setState((s) => ({ ...s, baskets: s.baskets.map((b) => (b.id === basketId ? { ...b, items: b.items.filter((i) => markKey(i) !== key) } : b)) }));
  }, []);

  const clearBasket = useCallback((id: string) => {
    setState((s) => ({ ...s, baskets: s.baskets.map((b) => (b.id === id ? { ...b, items: [] } : b)) }));
  }, []);

  const isMarked = useCallback(
    (item: Pick<MarkItem, 'kind' | 'filter'>) => {
      if (!current) return false;
      const key = markKey(item);
      return current.items.some((i) => markKey(i) === key);
    },
    [current],
  );

  const value: SelectApi = {
    ...state,
    current,
    setActive,
    createBasket,
    renameBasket,
    removeBasket,
    selectBasket,
    isMarked,
    toggle,
    add,
    removeItem,
    clearBasket,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Provider bo'lmasa (masalan, kirish sahifasi) — belgilash o'chiq holatda ishlaydi */
export function useReactionSelect(): SelectApi | null {
  return useContext(Context);
}