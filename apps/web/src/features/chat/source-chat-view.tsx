'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconArrowRight, IconSpinner } from '@/components/ui/icons';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { unitByCode } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { sourceChatApi, type ChatAnswer, type ChatContext } from './api';
import { ChatBlocks } from './blocks';

// ═══════════════════════════════════════════════════════════
// Chat › Manba chati — savol yozing, javob faqat tizim manbalaridan (taxminsiz):
//   xodim kartasi (JShShIR yoki F.I.Sh.), ish haqi, xarajat / daromad / natija (bo'lim, hudud, modda, davr),
//   solishtirish, «eng ko'p», so'nggi yozuvlar, xodimlar soni va ro'yxati.
//   Davom savollari oldingi javobdan kontekst oladi: «fevraldagi-chi?», «uning ish haqi», «shu bo'lim xarajati».
//   Har javobda — nima tushunilgani va qaysi manbadan olingani.
// ═══════════════════════════════════════════════════════════

type Msg = { kind: 'answer'; a: ChatAnswer } | { kind: 'pending'; text: string; id: string } | { kind: 'error'; text: string; error: string; id: string };

/** «…» bilan boshlanganlar — yuborilmaydi, yozish maydoniga qo'yiladi (F.I.Sh. yoki JShShIR yoziladi) */
const EXAMPLES: { title: string; items: string[] }[] = [
  { title: 'Xodim (miya) — F.I.Sh. yoki JShShIR yozing', items: ["… barcha ma'lumotlari", '… yanvardagi ish haqi', "… qaysi bo'limda", "… ko'chishlari", 'Uning shu yildagi ish haqi'] },
  { title: 'Xarajat va daromad', items: ["Fermer xo'jaligi xarajati shu yil oylar bo'yicha", 'Markaz daromadi va xarajati otgan oy', 'Ijara xarajati 1-chorak', "Andijon viloyati natijasi 2026 yil"] },
  { title: 'Ish haqi', items: ["Yanvardagi ish haqi bo'limlar bo'yicha", "Tax free ish haqi oxirgi 3 oy"] },
  { title: 'Tahlil', items: ["Eng ko'p xarajat qilgan hududlar shu yil", 'Yanvar va fevral xarajatlarini solishtir', "Xarajat moddalar bo'yicha shu oy", 'Oxirgi xarajat yozuvlari Markaz'] },
  { title: 'Xodimlar', items: ["Fermer xo'jaligi xodimlari ro'yxati", 'Nechta xodim bor', 'Andijon viloyati xodimlari soni'] },
  { title: 'Tizim', items: ['Manbalar', "Qanday bo'limlar bor"] },
];

const CTX_LABELS: { key: keyof ChatContext; label: string }[] = [
  { key: 'pinfl', label: 'Xodim' },
  { key: 'units', label: "Bo'lim" },
  { key: 'period', label: 'Davr' },
  { key: 'kind', label: "Ko'rsatkich" },
];

export function SourceChatView() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [ctx, setCtx] = useState<ChatContext>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    sourceChatApi
      .history()
      .then((r) => {
        if (!alive) return;
        const items = r.data ?? [];
        setMessages(items.map((a) => ({ kind: 'answer' as const, a })));
        setCtx(items[items.length - 1]?.context ?? {});
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const id = `p${Date.now()}`;
    setText('');
    setBusy(true);
    setMessages((m) => [...m, { kind: 'pending', text: question, id }]);
    try {
      const a = (await sourceChatApi.ask(question, ctx)).data;
      setMessages((m) => m.map((x) => (x.kind === 'pending' && x.id === id ? { kind: 'answer', a } : x)));
      setCtx(a.context ?? {});
    } catch (err) {
      setMessages((m) => m.map((x) => (x.kind === 'pending' && x.id === id ? { kind: 'error', text: question, error: errorMessage(err, "Javob olib bo'lmadi"), id } : x)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function clearAll() {
    await sourceChatApi.clear().catch(() => undefined);
    setMessages([]);
    setCtx({});
    setClearOpen(false);
  }

  const last = [...messages].reverse().find((m): m is Extract<Msg, { kind: 'answer' }> => m.kind === 'answer');
  const ctxChips = CTX_LABELS.map(({ key, label }) => {
    const v = ctx[key];
    if (!v || (Array.isArray(v) && !v.length)) return null;
    const shown = key === 'pinfl' ? (last?.a.understood.find((u) => u.label === 'Xodim')?.value ?? String(v)) : key === 'period' ? (v as { label: string }).label : key === 'units' ? (v as string[]).map((c) => unitByCode(c)?.label ?? c).join(', ') : key === 'kind' ? ({ expense: 'Xarajat', income: 'Daromad', result: 'Natija', payroll: 'Ish haqi' } as Record<string, string>)[String(v)] ?? String(v) : String(v);
    return { label, value: shown };
  }).filter((x): x is { label: string; value: string } => Boolean(x));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden">
        {/* Suhbat */}
        <div className="flex-1 space-y-5 overflow-auto bg-(--color-surface-muted)/40 px-4 py-5 sm:px-6">
          {!loaded ? (
            <div className="flex h-full items-center justify-center">
              <IconSpinner className="size-6 animate-spin text-brand-700" />
            </div>
          ) : messages.length === 0 ? (
            <Welcome onAsk={(q) => void ask(q)} />
          ) : (
            messages.map((m) =>
              m.kind === 'answer' ? (
                <Exchange key={m.a.id} a={m.a} onAsk={(q) => void ask(q)} />
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

      {/* Yon panel: kontekst va namunalar */}
      <div className="space-y-4">
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
              {ctxChips.map((c) => (
                <div key={c.label} className="flex gap-2 text-xs">
                  <dt className="w-24 shrink-0 text-(--color-text-muted)">{c.label}</dt>
                  <dd className="font-medium text-heading">{c.value}</dd>
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
                      <button
                        type="button"
                        onClick={() => {
                          if (x.startsWith('…')) {
                            setText(` ${x.slice(1).trim()}`);
                            requestAnimationFrame(() => {
                              inputRef.current?.focus();
                              inputRef.current?.setSelectionRange(0, 0);
                            });
                          } else void ask(x);
                        }}
                        className="w-full rounded px-1.5 py-1 text-left text-xs text-heading hover:bg-brand-50"
                      >
                        {x}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="mt-3 w-full text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setClearOpen(true)}>
              Suhbat tarixini tozalash
            </Button>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Suhbat tarixini tozalash"
        message="Bu chatdagi barcha savol va javoblar o'chiriladi (ma'lumotlarga tegilmaydi)."
        confirmLabel="Tozalash"
        danger
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}

function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2 text-sm whitespace-pre-wrap text-white shadow-sm">{text}</p>
    </div>
  );
}

function Exchange({ a, onAsk }: { a: ChatAnswer; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-2">
      <Question text={a.question} />
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800" title="Manba chati">
          M
        </div>
        <div className="min-w-0 flex-1 space-y-2.5 rounded-2xl rounded-tl-md border border-(--color-line) bg-white px-4 py-3 shadow-sm">
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--color-line) pt-2 text-[11px] text-(--color-text-muted)">
            {a.sources.length > 0 && <span>Manba: {a.sources.join(' · ')}</span>}
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
        (Xarajatlar siyosati bilan). Taxmin qilinmaydi — topilmasa, shuni aytadi.
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