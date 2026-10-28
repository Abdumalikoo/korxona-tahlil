'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconArrowRight, IconDownload, IconEdit, IconPlus, IconSearch, IconSpinner, IconTrash } from '@/components/ui/icons';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { unitByCode } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatPinApi, cleanMsg, exportItem, exportSaved, exportThread, isLocked, needsCode, needsSetup, setChatToken, sourceChatApi, type ChatAnswer, type ChatContext, type ChatPinRequire, type ChatThread, type SavedAnswer } from './api';
import { ChatLock, ChatSetup, CodeDialog } from './pin-pad';
import { ChatBlocks } from './blocks';

// ═══════════════════════════════════════════════════════════
// Chat › Manba chati — savolga javob faqat tizim manbalaridan (taxminsiz).
//   Chapda — suhbatlar: yangi suhbat, qidiruv, nomini o'zgartirish, qadash, o'chirish, hammasini o'chirish.
//   O'rtada — joriy suhbat: savol-javoblar; har javobda «Saqlash» (izoh bilan), «Nusxalash», «O'chirish»;
//   tepada — Excel'ga yuklab olish va suhbatni tozalash.
//   «Saqlanganlar» — muhim javoblar (suhbat o'chirilsa ham qoladi): izoh, Excel, o'chirish.
//   O'ngda — joriy kontekst (davom savollari uchun) va namuna savollar.
//   Chat kodi (Sozlamalar › Chat kodi): kirishda — qulf ekrani; saqlash, Excel va yangi suhbatda — kod oynasi.
// ═══════════════════════════════════════════════════════════

type Msg = { kind: 'answer'; a: ChatAnswer } | { kind: 'pending'; text: string; id: string } | { kind: 'error'; text: string; error: string; id: string };
type ToastState = { message: string; tone?: 'success' | 'error' } | null;
type Confirm = { title: string; message: string; label: string; run: () => Promise<void> } | null;
/** Kod so'rovi: tasdiqlanganda amal kod bilan bajariladi */
type CodeAsk = { title: string; description: string; run: (code: string) => Promise<void> } | null;
const msgOf = (err: unknown, fallback: string) => cleanMsg(errorMessage(err, fallback));

const ACTIVE_KEY = 'chat.source.active';
const readActive = () => {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};
const writeActive = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* brauzer xotirasi yo'q — muhim emas */
  }
};

/** «…» bilan boshlanganlar — yuborilmaydi, yozish maydoniga qo'yiladi (F.I.Sh. yoki JShShIR yoziladi) */
const EXAMPLES: { title: string; items: string[] }[] = [
  { title: 'Xodim (miya) — F.I.Sh. yoki JShShIR yozing', items: ["… barcha ma'lumotlari", '… yanvardagi ish haqi', "… qaysi bo'limda", "… ko'chishlari", 'Uning shu yildagi ish haqi'] },
  { title: 'Xarajat va daromad', items: ["Fermer xo'jaligi xarajati shu yil oylar bo'yicha", 'Markaz daromadi va xarajati otgan oy', 'Ijara xarajati 1-chorak', "Xarajat kontragentlar bo'yicha shu yil"] },
  { title: 'Solishtirish', items: ['Fermer va Tax free xarajatini solishtir', 'Andijon va Samarqand natijasini solishtir', "Xarajat o'tgan yilning shu davri bilan solishtir", 'Yanvar va fevral xarajatlarini solishtir'] },
  { title: 'Filtrlar', items: ["To'lanmagan xarajatlar", "5 mln dan katta xarajatlar shu yil", '«Artel» ga to‘langan', 'Asaka tumani xarajati shu yil'] },
  { title: 'Ish haqi', items: ["Yanvardagi ish haqi bo'limlar bo'yicha", "Eng ko'p ish haqi olgan xodimlar shu yil", "Fermer o'rtacha ish haqi"] },
  { title: 'Xodimlar tahlili', items: ['Ayol xodimlar soni', "40 yoshdan katta xodimlar lavozimlar bo'yicha", 'Buxgalterlar soni viloyatlar bo‘yicha', "Shu yil ishga kirganlar", "Fermer xodimlari yosh bo'yicha", 'Oliy ma‘lumotli xodimlar soni'] },
  { title: 'Tizim', items: ['Manbalar', "Qanday bo'limlar bor"] },
];

const KIND: Record<string, string> = { expense: 'Xarajat', income: 'Daromad', result: 'Natija', payroll: 'Ish haqi' };

function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'hozir';
  if (d < 3600) return `${Math.floor(d / 60)} daq oldin`;
  if (d < 86400) return `${Math.floor(d / 3600)} soat oldin`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)} kun oldin`;
  return formatDateTime(iso).slice(0, 10);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ─────────── Kichik belgilar ───────────

function IconStar({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}
function IconPin({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7" />
    </svg>
  );
}
function IconCopy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

// ═══════════ Asosiy ko'rinish ═══════════

export function SourceChatView() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [ctx, setCtx] = useState<ChatContext>({});
  const [saved, setSaved] = useState<SavedAnswer[]>([]);
  const [view, setView] = useState<'chat' | 'saved'>('chat');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [pinReq, setPinReq] = useState<ChatPinRequire | null>(null);
  const [locked, setLocked] = useState(false);
  /** Standart kod turibdi — avval o'z kodini o'rnatish */
  const [setup, setSetup] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [codeAsk, setCodeAsk] = useState<CodeAsk>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [bootKey, setBootKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;
  const savedByAnswer = useMemo(() => new Map(saved.map((s) => [s.answer.id, s])), [saved]);

  const loadThreads = useCallback(async () => {
    const list = (await sourceChatApi.threads()).data ?? [];
    setThreads(list);
    return list;
  }, []);

  const openThread = useCallback(async (id: string | null) => {
    setActiveId(id);
    writeActive(id);
    setView('chat');
    setRenaming(null);
    if (!id) {
      setMessages([]);
      setCtx({});
      return;
    }
    setThreadLoading(true);
    try {
      const t = (await sourceChatApi.thread(id)).data;
      setMessages(t.items.map((a) => ({ kind: 'answer' as const, a })));
      setCtx(t.items[t.items.length - 1]?.context ?? {});
    } catch {
      setMessages([]);
      setCtx({});
      setActiveId(null);
      writeActive(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = (await chatPinApi.status()).data;
        if (!alive) return;
        setPinReq(st.require);
        if (st.mustSetCode) {
          setChatToken(null);
          setSetup(true);
          return;
        }
        setSetup(false);
        if (!st.unlocked) {
          setChatToken(null);
          setLocked(true);
          return;
        }
        setLocked(false);
        const [list, sv] = await Promise.all([loadThreads(), sourceChatApi.saved().then((r) => r.data ?? []).catch(() => [] as SavedAnswer[])]);
        if (!alive) return;
        setSaved(sv);
        const remembered = readActive();
        const pick = list.find((t) => t.id === remembered) ?? null;
        await openThread(pick?.id ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadThreads, openThread, bootKey]);

  /** Server «qulflangan» desa — qulf ekrani */
  const lockIfNeeded = (err: unknown): boolean => {
    const m = errorMessage(err, '');
    if (needsSetup(m)) {
      setChatToken(null);
      setSetup(true);
      return true;
    }
    if (!isLocked(m)) return false;
    setChatToken(null);
    setLocked(true);
    return true;
  };

  async function unlock(code: string) {
    setUnlocking(true);
    setLockError(null);
    try {
      const r = (await chatPinApi.unlock(code)).data;
      setChatToken(r.token);
      setLoading(true);
      setBootKey((k) => k + 1);
    } catch (err) {
      setLockError(msgOf(err, "Kod noto'g'ri"));
    } finally {
      setUnlocking(false);
    }
  }

  /** Birinchi sozlash: standart kod → o'z kodi, keyin darhol kirish */
  async function firstSetup(current: string, next: string) {
    setUnlocking(true);
    setLockError(null);
    try {
      await chatPinApi.update({ currentCode: current, newCode: next });
      if (pinReq?.use !== false) {
        const r = (await chatPinApi.unlock(next)).data;
        setChatToken(r.token);
      }
      setSetup(false);
      setLoading(true);
      setBootKey((k) => k + 1);
    } catch (err) {
      setLockError(msgOf(err, "Kodni o'rnatib bo'lmadi"));
    } finally {
      setUnlocking(false);
    }
  }

  /** Kod kerak bo'lsa — oyna; bo'lmasa — darhol */
  function withCode(need: boolean, title: string, description: string, run: (code?: string) => Promise<void>) {
    if (!need) {
      void run().catch((err) => {
        if (lockIfNeeded(err)) return;
        if (needsCode(errorMessage(err, ''))) {
          setCodeError(null);
          setCodeAsk({ title, description, run: (c) => run(c) });
          return;
        }
        setToast({ message: msgOf(err, 'Xatolik'), tone: 'error' });
      });
      return;
    }
    setCodeError(null);
    setCodeAsk({ title, description, run: (c) => run(c) });
  }

  async function submitCode(code: string) {
    if (!codeAsk) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      await codeAsk.run(code);
      setCodeAsk(null);
    } catch (err) {
      if (lockIfNeeded(err)) {
        setCodeAsk(null);
        return;
      }
      const m = msgOf(err, 'Xatolik');
      if (/kod|Kod/.test(m)) setCodeError(m);
      else {
        setCodeAsk(null);
        setToast({ message: m, tone: 'error' });
      }
    } finally {
      setCodeBusy(false);
    }
  }

  function newChat() {
    withCode(Boolean(pinReq?.newChat), 'Yangi suhbat', 'Yangi suhbat ochish uchun chat kodini kiriting', async (code) => {
      const t = (await sourceChatApi.create(code)).data;
      setThreads((ts) => [t, ...ts]);
      await openThread(t.id);
      inputRef.current?.focus();
    });
  }

  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, view]);

  async function ask(q: string, code?: string) {
    const question = q.trim();
    if (!question || busy) return;
    if (!activeId && pinReq?.newChat && !code) {
      // Suhbat yo'q — yangi suhbat uchun kod
      setCodeError(null);
      setCodeAsk({ title: 'Yangi suhbat', description: 'Birinchi savol yangi suhbat ochadi — chat kodini kiriting', run: (c) => ask(question, c) });
      return;
    }
    setView('chat');
    const pid = `p${Date.now()}`;
    setText('');
    setBusy(true);
    setMessages((m) => [...m, { kind: 'pending', text: question, id: pid }]);
    try {
      const a = (await sourceChatApi.ask(question, ctx, activeId, code)).data;
      setMessages((m) => m.map((x) => (x.kind === 'pending' && x.id === pid ? { kind: 'answer', a } : x)));
      setCtx(a.context ?? {});
      // «Excel ber», «tashla» — fayl darhol yuklab olinadi
      if (a.file && a.threadId) downloadItem(a.threadId, a.file.itemId);
      if (a.threadId !== activeId) {
        setActiveId(a.threadId);
        writeActive(a.threadId);
      }
      setThreads((ts) => [a.thread, ...ts.filter((t) => t.id !== a.thread.id)].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.updatedAt.localeCompare(x.updatedAt)));
    } catch (err) {
      if (lockIfNeeded(err)) {
        setMessages((m) => m.filter((x) => !(x.kind === 'pending' && x.id === pid)));
        return;
      }
      if (code && /kod/i.test(errorMessage(err, ''))) {
        // Noto'g'ri kod — savol qoladi, kod oynasi ochiq turadi
        setMessages((m) => m.filter((x) => !(x.kind === 'pending' && x.id === pid)));
        setText(question);
        throw err;
      }
      setMessages((m) => m.map((x) => (x.kind === 'pending' && x.id === pid ? { kind: 'error', text: question, error: msgOf(err, "Javob olib bo'lmadi"), id: pid } : x)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function ask0(q: string) {
    if (q.startsWith('…')) {
      setText(` ${q.slice(1).trim()}`);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(0, 0);
      });
    } else void ask(q);
  }

  // ─────────── Amallar ───────────

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setToast({ message: ok });
    } catch (err) {
      if (lockIfNeeded(err)) return;
      setToast({ message: msgOf(err, 'Xatolik'), tone: 'error' });
    }
  };

  async function rename(id: string, title: string) {
    const t = title.trim();
    setRenaming(null);
    if (!t || t === threads.find((x) => x.id === id)?.title) return;
    await act(async () => {
      const r = (await sourceChatApi.update(id, { title: t })).data;
      setThreads((ts) => ts.map((x) => (x.id === id ? r : x)));
    });
  }

  async function togglePin(t: ChatThread) {
    await act(async () => {
      await sourceChatApi.update(t.id, { pinned: !t.pinned });
      await loadThreads();
    }, t.pinned ? 'Qadash olib tashlandi' : 'Suhbat qadaldi — ro‘yxat tepasida turadi');
  }

  function askConfirm(c: NonNullable<Confirm>) {
    setConfirm(c);
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Xatolik'), tone: 'error' });
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  }

  const deleteThread = (t: ChatThread) =>
    askConfirm({
      title: "Suhbatni o'chirish",
      message: `«${t.title}» va undagi ${t.count} ta savol-javob o'chiriladi. Saqlangan javoblar qoladi.`,
      label: "O'chirish",
      run: async () => {
        await sourceChatApi.remove(t.id);
        await loadThreads();
        if (activeId === t.id) await openThread(null);
        setToast({ message: "Suhbat o'chirildi" });
      },
    });

  const clearThread = () =>
    active &&
    askConfirm({
      title: 'Suhbatni tozalash',
      message: `«${active.title}» ichidagi ${active.count} ta savol-javob o'chiriladi, suhbatning o'zi qoladi. Saqlangan javoblar qoladi.`,
      label: 'Tozalash',
      run: async () => {
        const r = (await sourceChatApi.clear(active.id)).data;
        setThreads((ts) => ts.map((x) => (x.id === r.id ? r : x)));
        setMessages([]);
        setCtx({});
        setToast({ message: 'Suhbat tozalandi' });
      },
    });

  const deleteAll = (keepPinned: boolean) =>
    askConfirm({
      title: keepPinned ? "Qadalmagan suhbatlarni o'chirish" : "Hamma suhbatlarni o'chirish",
      message: keepPinned
        ? "Qadalmagan hamma suhbatlar o'chiriladi. Qadalganlar va saqlangan javoblar qoladi."
        : "Hamma suhbatlar (qadalganlari ham) o'chiriladi. Saqlangan javoblar qoladi. Ma'lumotlarga tegilmaydi.",
      label: "O'chirish",
      run: async () => {
        const r = (await sourceChatApi.removeAll(keepPinned)).data;
        const list = await loadThreads();
        if (!list.some((t) => t.id === activeId)) await openThread(null);
        setToast({ message: `${r.deleted} ta suhbat o'chirildi` });
      },
    });

  const removeItem = (a: ChatAnswer) =>
    active &&
    askConfirm({
      title: "Javobni o'chirish",
      message: `«${a.question}» savoli va javobi suhbatdan o'chiriladi.`,
      label: "O'chirish",
      run: async () => {
        const r = (await sourceChatApi.removeItem(active.id, a.id)).data;
        setThreads((ts) => ts.map((x) => (x.id === r.id ? r : x)));
        setMessages((m) => m.filter((x) => !(x.kind === 'answer' && x.a.id === a.id)));
      },
    });

  async function toggleSave(a: ChatAnswer) {
    const s = savedByAnswer.get(a.id);
    if (s) {
      await act(async () => {
        await sourceChatApi.unsave(s.id);
        setSaved((l) => l.filter((x) => x.id !== s.id));
      }, 'Saqlanganlardan olib tashlandi');
      return;
    }
    if (!activeId) return;
    const tid = activeId;
    withCode(Boolean(pinReq?.save), 'Javobni saqlash', 'Saqlash uchun chat kodini kiriting', async (code) => {
      const r = (await sourceChatApi.save(tid, a.id, code)).data;
      setSaved((l) => [r, ...l.filter((x) => x.id !== r.id)]);
      setToast({ message: 'Saqlandi — «Saqlanganlar»da izoh qo‘shishingiz mumkin' });
    });
  }

  /** Bitta javob — Excel fayl */
  function downloadItem(threadId: string, itemId: string) {
    withCode(Boolean(pinReq?.save), "Excel'ga yuklab olish", 'Javobni faylga saqlash uchun chat kodini kiriting', (code) => exportItem(threadId, itemId, code));
  }

  async function copyAnswer(a: ChatAnswer) {
    if (!activeId) return;
    await act(async () => {
      const t = (await sourceChatApi.itemText(activeId, a.id)).data.text;
      if (!(await copyText(t))) throw new Error("Nusxalab bo'lmadi");
    }, 'Javob matni nusxalandi');
  }

  const filtered = threads.filter((t) => !search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase()));
  const last = [...messages].reverse().find((m): m is Extract<Msg, { kind: 'answer' }> => m.kind === 'answer');

  const ctxChips = (
    [
      ['Xodim', ctx.pinfl ? (last?.a.understood.find((u) => u.label === 'Xodim')?.value ?? ctx.pinfl) : null],
      ["Bo'lim", ctx.units?.length ? ctx.units.map((c) => unitByCode(c)?.label ?? c).join(', ') : null],
      ['Davr', ctx.period?.label ?? null],
      ["Ko'rsatkich", ctx.kind ? (KIND[ctx.kind] ?? ctx.kind) : null],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => Boolean(x[1]));

  if (setup) return <ChatSetup onSubmit={(c, n) => void firstSetup(c, n)} busy={unlocking} error={lockError} />;
  if (locked) return <ChatLock onUnlock={(c) => void unlock(c)} busy={unlocking} error={lockError} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[16.5rem_minmax(0,1fr)] 2xl:grid-cols-[16.5rem_minmax(0,1fr)_18rem]">
      {/* ─── Suhbatlar ─── */}
      <Card className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-(--color-line) p-3">
          <Button className="w-full" onClick={() => newChat()}>
            <IconPlus className="size-4" />
            Yangi suhbat
          </Button>
          <div className="relative">
            <IconSearch className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suhbatlardan qidirish"
              className="h-8 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-2 pl-8 text-xs focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setView(view === 'saved' ? 'chat' : 'saved')}
          className={cn('flex items-center gap-2 border-b border-(--color-line) px-3 py-2.5 text-left text-sm transition-colors', view === 'saved' ? 'bg-amber-50 font-semibold text-amber-900' : 'hover:bg-(--color-surface-muted)')}
        >
          <IconStar filled={view === 'saved'} className="size-4 text-amber-500" />
          <span className="flex-1">Saqlanganlar</span>
          <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{saved.length}</span>
        </button>
        <div className="flex-1 overflow-auto py-1">
          {loading ? (
            <div className="flex justify-center py-6">
              <IconSpinner className="size-5 animate-spin text-brand-700" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-(--color-text-muted)">{search ? 'Topilmadi' : "Hali suhbat yo'q — savol yozing"}</p>
          ) : (
            filtered.map((t, i) => {
              const showHead = i === 0 || filtered[i - 1]!.pinned !== t.pinned;
              return (
                <div key={t.id}>
                  {showHead && <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-(--color-text-faint)">{t.pinned ? 'Qadalgan' : 'Suhbatlar'}</p>}
                  <div className={cn('group mx-1.5 flex items-center gap-1 rounded-(--radius-control) px-2 py-1.5', activeId === t.id && view === 'chat' ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-(--color-surface-muted)')}>
                    {renaming === t.id ? (
                      <input
                        autoFocus
                        defaultValue={t.title}
                        maxLength={80}
                        onBlur={(e) => void rename(t.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(t.id, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="h-7 min-w-0 flex-1 rounded border border-brand-400 px-1.5 text-xs focus:outline-none"
                      />
                    ) : (
                      <button type="button" onClick={() => void openThread(t.id)} className="min-w-0 flex-1 text-left" title={t.title}>
                        <span className="block truncate text-[13px] text-heading">{t.title}</span>
                        <span className="block text-[10.5px] text-(--color-text-faint)">
                          {t.count} ta savol · {relTime(t.updatedAt)}
                        </span>
                      </button>
                    )}
                    {renaming !== t.id && (
                      <span className={cn('flex shrink-0 items-center', t.pinned ? '' : 'opacity-0 group-hover:opacity-100')}>
                        <button type="button" title={t.pinned ? 'Qadashni olib tashlash' : 'Qadash'} onClick={() => void togglePin(t)} className={cn('rounded p-1 hover:bg-white', t.pinned ? 'text-brand-700' : 'text-(--color-text-faint)')}>
                          <IconPin filled={t.pinned} className="size-3.5" />
                        </button>
                        <button type="button" title="Nomini o'zgartirish" onClick={() => setRenaming(t.id)} className="rounded p-1 text-(--color-text-faint) opacity-0 group-hover:opacity-100 hover:bg-white">
                          <IconEdit className="size-3.5" />
                        </button>
                        <button type="button" title="O'chirish" onClick={() => deleteThread(t)} className="rounded p-1 text-(--color-text-faint) opacity-0 group-hover:opacity-100 hover:bg-white hover:text-(--color-expense)">
                          <IconTrash className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {threads.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-(--color-line) px-3 py-2 text-[11px]">
            {threads.some((t) => t.pinned) && (
              <button type="button" onClick={() => deleteAll(true)} className="text-(--color-text-muted) hover:text-(--color-expense)">
                Qadalmaganlarini o&apos;chirish
              </button>
            )}
            <button type="button" onClick={() => deleteAll(false)} className="text-(--color-text-muted) hover:text-(--color-expense)">
              Hammasini o&apos;chirish
            </button>
          </div>
        )}
      </Card>

      {/* ─── Suhbat yoki saqlanganlar ─── */}
      {view === 'saved' ? (
        <SavedView
          saved={saved}
          setSaved={setSaved}
          onOpen={(s) => {
            if (s.threadId && threads.some((t) => t.id === s.threadId)) void openThread(s.threadId);
            else setToast({ message: "Bu javobning suhbati o'chirilgan — javob shu yerda saqlangan", tone: 'error' });
          }}
          onAsk={(q) => ask0(q)}
          onToast={setToast}
          onConfirm={askConfirm}
          onExport={(ids) => withCode(Boolean(pinReq?.save), "Excel'ga yuklab olish", 'Saqlanganlarni faylga saqlash uchun chat kodini kiriting', (code) => exportSaved(ids, code))}
        />
      ) : (
        <Card className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden">
          {/* Sarlavha */}
          <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-heading">{active?.title ?? 'Yangi suhbat'}</p>
              <p className="text-[11px] text-(--color-text-muted)">{active ? `${active.count} ta savol · ${formatDateTime(active.createdAt)} da boshlangan` : 'Birinchi savol yuborilganda suhbat saqlanadi'}</p>
            </div>
            {active && (
              <>
                <Button variant="ghost" size="sm" onClick={() => void togglePin(active)} title={active.pinned ? 'Qadashni olib tashlash' : 'Qadash'}>
                  <IconPin filled={active.pinned} className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRenaming(active.id)} title="Nomini o'zgartirish (chap ro'yxatda)">
                  <IconEdit className="size-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!active.count}
                  onClick={() => withCode(Boolean(pinReq?.save), "Excel'ga yuklab olish", 'Suhbatni faylga saqlash uchun chat kodini kiriting', (code) => exportThread(active.id, code))}
                >
                  <IconDownload className="size-4" />
                  Excel
                </Button>
                <Button variant="ghost" size="sm" disabled={!active.count} onClick={() => clearThread()} className="text-(--color-text-muted) hover:text-(--color-expense)">
                  Tozalash
                </Button>
              </>
            )}
          </div>

          {/* Savol-javoblar */}
          <div className="flex-1 space-y-5 overflow-auto bg-(--color-surface-muted)/40 px-4 py-5 sm:px-6">
            {loading || threadLoading ? (
              <div className="flex h-full items-center justify-center">
                <IconSpinner className="size-6 animate-spin text-brand-700" />
              </div>
            ) : messages.length === 0 ? (
              <Welcome onAsk={(q) => void ask(q)} />
            ) : (
              messages.map((m) =>
                m.kind === 'answer' ? (
                  <Exchange
                    key={m.a.id}
                    a={m.a}
                    saved={savedByAnswer.has(m.a.id)}
                    onAsk={(q) => void ask(q)}
                    onSave={() => void toggleSave(m.a)}
                    onCopy={() => void copyAnswer(m.a)}
                    onExcel={activeId ? () => downloadItem(activeId, m.a.file?.itemId ?? m.a.id) : undefined}
                    onDelete={() => removeItem(m.a)}
                  />
                ) : (
                  <div key={m.id} className="space-y-2">
                    <Question text={m.text} />
                    {m.kind === 'pending' ? (
                      <div className="flex items-center gap-2 text-sm text-(--color-text-muted)">
                        <IconSpinner className="size-4 animate-spin text-brand-700" />
                        Manbalardan qidirilmoqda…
                      </div>
                    ) : (
                      <p className="rounded-(--radius-control) border border-(--color-expense)/30 bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{m.error}</p>
                    )}
                  </div>
                ),
              )
            )}
            <div ref={endRef} />
          </div>

          {/* Davom savollari */}
          {last && last.a.suggestions.length > 0 && !busy && (
            <div className="flex flex-wrap gap-1.5 border-t border-(--color-line) bg-white px-4 pt-2.5 sm:px-6">
              {last.a.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:border-brand-500">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Yozish */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
            className="flex items-end gap-2 border-t border-(--color-line) bg-white px-4 py-3 sm:px-6"
          >
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              maxLength={500}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(text);
                }
              }}
              placeholder="Savol yozing — Enter: yuborish, Shift+Enter: yangi qator"
              className="max-h-36 min-h-[44px] flex-1 resize-none rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <Button type="submit" loading={busy} disabled={!text.trim()} className="h-11">
              <IconArrowRight className="size-4" />
              Yuborish
            </Button>
          </form>
        </Card>
      )}

      {/* ─── Kontekst va namunalar ─── */}
      <div className="hidden space-y-4 2xl:block">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-heading">Joriy kontekst</p>
            {ctxChips.length > 0 && (
              <button type="button" onClick={() => setCtx({})} className="text-xs font-semibold text-brand-700 hover:underline">
                Tozalash
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-(--color-text-muted)">Davom savollari shundan oladi: «fevraldagi-chi?», «uning ish haqi», «shu bo&apos;lim xarajati».</p>
          {ctxChips.length ? (
            <dl className="mt-2 space-y-1">
              {ctxChips.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <dt className="w-24 shrink-0 text-(--color-text-muted)">{k}</dt>
                  <dd className="font-medium text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-xs text-(--color-text-faint)">bo&apos;sh</p>
          )}
        </Card>
        <Card className="max-h-[calc(100vh-24rem)] overflow-auto p-4">
          <p className="text-sm font-semibold text-heading">Nimalarni so&apos;rash mumkin</p>
          <div className="mt-2 space-y-3">
            {EXAMPLES.map((g) => (
              <div key={g.title}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{g.title}</p>
                <ul className="mt-1 space-y-0.5">
                  {g.items.map((x) => (
                    <li key={x}>
                      <button type="button" onClick={() => ask0(x)} className="w-full rounded px-1.5 py-1 text-left text-xs text-heading hover:bg-brand-50">
                        {x}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label}
        danger
        loading={confirmBusy}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      />
      {codeAsk && <CodeDialog title={codeAsk.title} description={codeAsk.description} busy={codeBusy} error={codeError} onSubmit={(c) => void submitCode(c)} onCancel={() => setCodeAsk(null)} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

// ═══════════ Saqlanganlar ═══════════

function SavedView({
  saved,
  setSaved,
  onOpen,
  onAsk,
  onToast,
  onConfirm,
  onExport,
}: {
  saved: SavedAnswer[];
  setSaved: (fn: (l: SavedAnswer[]) => SavedAnswer[]) => void;
  onOpen: (s: SavedAnswer) => void;
  onAsk: (q: string) => void;
  onToast: (t: ToastState) => void;
  onConfirm: (c: NonNullable<Confirm>) => void;
  onExport: (ids?: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const list = saved.filter((s) => !q.trim() || `${s.answer.question} ${s.note ?? ''} ${s.threadTitle ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function saveNote(s: SavedAnswer, note: string) {
    setEditing(null);
    if ((s.note ?? '') === note.trim()) return;
    try {
      const r = (await sourceChatApi.updateSaved(s.id, note)).data;
      setSaved((l) => l.map((x) => (x.id === r.id ? r : x)));
    } catch (err) {
      onToast({ message: errorMessage(err, "Izohni saqlab bo'lmadi"), tone: 'error' });
    }
  }

  return (
    <Card className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-heading">
            <IconStar filled className="size-4 text-amber-500" />
            Saqlangan javoblar
          </p>
          <p className="text-[11px] text-(--color-text-muted)">{saved.length} ta · suhbat o&apos;chirilsa ham qoladi · izoh qo&apos;shish mumkin</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Qidirish"
          className="h-8 w-48 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2.5 text-xs focus:border-brand-500 focus:outline-none"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!list.length}
          onClick={() =>
            onExport(list.length === saved.length ? undefined : list.map((s) => s.id))
          }
        >
          <IconDownload className="size-4" />
          Excel{list.length !== saved.length ? ` (${list.length})` : ''}
        </Button>
        {saved.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-(--color-text-muted) hover:text-(--color-expense)"
            onClick={() =>
              onConfirm({
                title: "Saqlanganlarni o'chirish",
                message: `${saved.length} ta saqlangan javob o'chiriladi (suhbatlardagi asli qoladi).`,
                label: "O'chirish",
                run: async () => {
                  await sourceChatApi.clearSaved();
                  setSaved(() => []);
                },
              })
            }
          >
            Hammasini o&apos;chirish
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-auto bg-(--color-surface-muted)/40 p-4">
        {list.length === 0 ? (
          <div className="py-16 text-center">
            <IconStar className="mx-auto size-10 text-(--color-text-faint)" />
            <p className="mt-3 text-sm font-semibold text-heading">{saved.length ? 'Topilmadi' : "Hali saqlangan javob yo'q"}</p>
            <p className="mt-1 text-xs text-(--color-text-muted)">Javob ostidagi ☆ «Saqlash» tugmasini bosing — u shu yerda qoladi.</p>
          </div>
        ) : (
          list.map((s) => {
            const isOpen = open.has(s.id);
            const first = s.answer.blocks.find((b) => b.type === 'text');
            return (
              <div key={s.id} className="rounded-(--radius-card) border border-(--color-line) bg-white shadow-sm">
                <div className="flex items-start gap-3 px-4 py-3">
                  <IconStar filled className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-heading">{s.answer.question}</p>
                    {first && first.type === 'text' && !isOpen && <p className="mt-0.5 line-clamp-2 text-xs text-(--color-text-muted)">{first.text}</p>}
                    <p className="mt-1 text-[11px] text-(--color-text-faint)">
                      {formatDateTime(s.savedAt)} saqlangan{s.threadTitle ? ` · suhbat: ${s.threadTitle}` : ''}
                    </p>
                    {editing === s.id ? (
                      <input
                        autoFocus
                        defaultValue={s.note ?? ''}
                        maxLength={300}
                        placeholder="Izoh: nima uchun saqlandi…"
                        onBlur={(e) => void saveNote(s, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveNote(s, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="mt-1.5 h-8 w-full rounded-(--radius-control) border border-brand-400 px-2 text-xs focus:outline-none"
                      />
                    ) : (
                      <button type="button" onClick={() => setEditing(s.id)} className={cn('mt-1.5 rounded px-1.5 py-0.5 text-left text-xs', s.note ? 'bg-amber-50 text-amber-900' : 'text-brand-700 hover:bg-brand-50')}>
                        {s.note ? `Izoh: ${s.note}` : '+ Izoh qo‘shish'}
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setOpen((o) => (o.has(s.id) ? new Set([...o].filter((x) => x !== s.id)) : new Set([...o, s.id])))}>
                      {isOpen ? 'Yig‘ish' : 'Ochish'}
                    </Button>
                    <Button variant="ghost" size="sm" title="Excel'ga" onClick={() => onExport([s.id])}>
                      <IconDownload className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" title="Suhbatda ochish" onClick={() => onOpen(s)}>
                      <IconArrowRight className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Saqlanganlardan olib tashlash"
                      className="text-(--color-text-muted) hover:text-(--color-expense)"
                      onClick={async () => {
                        try {
                          await sourceChatApi.unsave(s.id);
                          setSaved((l) => l.filter((x) => x.id !== s.id));
                        } catch (err) {
                          onToast({ message: errorMessage(err, 'Xatolik'), tone: 'error' });
                        }
                      }}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-(--color-line) px-4 py-3">
                    <ChatBlocks blocks={s.answer.blocks} onAsk={onAsk} />
                    {s.answer.sources.length > 0 && <p className="mt-2 text-[11px] text-(--color-text-muted)">Manba: {s.answer.sources.join(' · ')}</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ═══════════ Xabarlar ═══════════

function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2 text-sm whitespace-pre-wrap text-white shadow-sm">{text}</p>
    </div>
  );
}

function Exchange({ a, saved, onAsk, onSave, onCopy, onExcel, onDelete }: { a: ChatAnswer; saved: boolean; onAsk: (q: string) => void; onSave: () => void; onCopy: () => void; onExcel?: () => void; onDelete: () => void }) {
  // Excel tugmasi — jadval/ko'rsatkich bor javobda yoki fayl buyrug'i javobida
  const hasData = Boolean(a.file) || a.blocks.some((b) => b.type !== 'text' && b.type !== 'choices');
  return (
    <div className="group/ex space-y-2">
      <Question text={a.question} />
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800" title="Manba chati">
          M
        </div>
        <div className={cn('min-w-0 flex-1 space-y-2.5 rounded-2xl rounded-tl-md border bg-white px-4 py-3 shadow-sm', saved ? 'border-amber-300' : 'border-(--color-line)')}>
          {a.understood.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {a.understood.map((u) => (
                <span key={u.label} className={cn('rounded-full px-2 py-0.5 text-[10.5px]', u.label === 'Eslatma' || u.label === 'Oldingi savoldan' ? 'bg-amber-50 text-amber-800' : 'bg-(--color-surface-muted) text-(--color-text-muted)')}>
                  {u.label}: <b className="font-semibold text-heading">{u.value}</b>
                </span>
              ))}
            </div>
          )}
          <ChatBlocks blocks={a.blocks} onAsk={onAsk} />
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-(--color-line) pt-2 text-[11px] text-(--color-text-muted)">
            <button type="button" onClick={onSave} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 font-medium', saved ? 'bg-amber-50 text-amber-800' : 'hover:bg-amber-50 hover:text-amber-800')}>
              <IconStar filled={saved} className="size-3.5" />
              {saved ? 'Saqlangan' : 'Saqlash'}
            </button>
            <button type="button" onClick={onCopy} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-(--color-surface-muted) hover:text-heading">
              <IconCopy className="size-3.5" />
              Nusxalash
            </button>
            {onExcel && hasData && (
              <button type="button" onClick={onExcel} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-(--color-income-soft) hover:text-(--color-income)" title="Shu javobni Excel faylga">
                <IconDownload className="size-3.5" />
                Excel
              </button>
            )}
            <button type="button" onClick={onDelete} className="flex items-center gap-1 rounded px-1.5 py-0.5 opacity-60 group-hover/ex:opacity-100 hover:bg-(--color-expense-soft) hover:text-(--color-expense)">
              <IconTrash className="size-3.5" />
              O&apos;chirish
            </button>
            {a.sources.length > 0 && <span className="ml-2 min-w-0 flex-1 truncate" title={a.sources.join(' · ')}>Manba: {a.sources.join(' · ')}</span>}
            <span className="ml-auto">{formatDateTime(a.at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Welcome({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="mx-auto max-w-2xl py-8 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white shadow">M</div>
      <h2 className="mt-4 text-lg font-bold text-heading">Manba chati</h2>
      <p className="mt-1 text-sm text-(--color-text-muted)">
        Savol bering — javob faqat tizimdagi manbalardan: ma&apos;lumotnomalar (10/16/37/51-jadval), Xodimlar bazasi, ish haqi vedomostlari, daromad va xarajatlar
        (Xarajatlar siyosati bilan). Taxmin qilinmaydi — topilmasa, shuni aytadi. Suhbat avtomatik saqlanadi.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {["Fermer xo'jaligi xarajati shu yil oylar bo'yicha", "Yanvardagi ish haqi bo'limlar bo'yicha", "Eng ko'p xarajat qilgan hududlar shu yil", 'Nechta xodim bor', 'Manbalar'].map((q) => (
          <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border border-(--color-line) bg-white px-3 py-1.5 text-xs text-heading hover:border-brand-500 hover:bg-brand-50">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}