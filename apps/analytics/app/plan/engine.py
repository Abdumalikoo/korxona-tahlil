"""Hudud uchun reja — tarixiy test, model tanlash, daromad va sifat tekshiruvi.

Asosiy birlik — har bir hudud va xizmat bo'yicha oylik xizmatlar soni Q[h, s, oy].
Daromad = prognoz soni × tarif. Hudud jami = 39 xizmat yig'indisi; korxona jami = hududlar yig'indisi.

Tarixiy test — kengayuvchi oyna (expanding window, rolling origin): har bir test oyi k uchun model faqat
k dan oldingi oylarda o'qitiladi va k-oyni prognozlaydi. Hamma modellar bir xil test oylarida solishtiriladi.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import models as M

#: Tarixiy testda modellar bir xil oylarda solishtirilishi uchun kerakli eng kam nuqtalar
MIN_COMMON_POINTS = 3
#: Murakkab model sodda modeldan shu nisbatdan ko'proq yaxshi bo'lmasa — sodda model tanlanadi
SIMPLER_TOLERANCE = 0.02
#: Noaniqlik oralig'i uchun kerakli eng kam tarixiy xatolar soni
MIN_RESIDUALS_FOR_INTERVAL = 6


def period_add(period: str, n: int) -> str:
    y, m = (int(x) for x in period.split("-"))
    t = y * 12 + (m - 1) + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def months_between(start: str, end: str) -> list[str]:
    out, cur = [], start
    while cur <= end and len(out) < 240:
        out.append(cur)
        cur = period_add(cur, 1)
    return out


# ───────────────────────── Xato ko'rsatkichlari ─────────────────────────


def metrics(actual: np.ndarray, pred: np.ndarray) -> dict[str, float | None]:
    """MAE, RMSE, WAPE (%). Haqiqiy qiymatlar yig'indisi 0 bo'lsa WAPE aniqlanmaydi (None)."""
    if actual.size == 0:
        return {"mae": None, "rmse": None, "wape": None, "bias": None}
    err = actual - pred
    denom = float(np.sum(np.abs(actual)))
    return {
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "wape": float(np.sum(np.abs(err)) / denom * 100) if denom > 0 else None,
        "bias": float(np.sum(pred - actual) / denom * 100) if denom > 0 else None,
    }


# ───────────────────────── Tariflar ─────────────────────────


@dataclass(frozen=True)
class Tariff:
    service: str
    region: int | None
    valid_from: str  # YYYY-MM-DD
    price: float  # so'm


class TariffBook:
    """Tarif — oy oxirida amalda bo'lgani; hududga xos tarif umumiydan ustun."""

    def __init__(self, items: list[dict[str, Any]]):
        self.items = sorted(
            (Tariff(str(i["service"]), i.get("region"), str(i["validFrom"])[:10], float(i["price"])) for i in items),
            key=lambda t: t.valid_from,
        )

    def at(self, service: str, region: int, period: str) -> float | None:
        end = f"{period_add(period, 1)}-01"
        best_r: Tariff | None = None
        best_g: Tariff | None = None
        for t in self.items:
            if t.service != service or t.valid_from >= end:
                continue
            if t.region == region:
                best_r = t
            elif t.region is None:
                best_g = t
        chosen = best_r or best_g
        return chosen.price if chosen else None


# ───────────────────────── Bitta qator: tarixiy test va tanlov ─────────────────────────


def backtest(y: np.ndarray, test_months: int, min_train: int = 3) -> dict[str, dict[int, float]]:
    """Har bir model uchun test oylaridagi prognozlar {model: {k: forecast}}. k — indeks."""
    n = y.size
    start = max(min_train, n - test_months)
    out: dict[str, dict[int, float]] = {name: {} for name in M.COMPLEXITY}
    for k in range(start, n):
        if np.isnan(y[k]):
            continue
        train = y[:k]  # faqat k dan oldingi oylar — kelajak ishlatilmaydi
        inter = M.is_intermittent(train)
        for name in M.COMPLEXITY:
            if inter and name in ("holt", "hw"):
                continue
            if not inter and name in ("croston", "sba"):
                continue
            fit = M.forecast(name, train)
            if fit is not None:
                out[name][k] = fit.forecast
    return {k: v for k, v in out.items() if v}


def detect_outliers(y: np.ndarray, months: list[str]) -> list[dict[str, Any]]:
    """Keskin o'zgarishlar: mediana va MAD bo'yicha (robust z > 4). O'chirilmaydi — faqat belgilanadi."""
    obs = ~np.isnan(y)
    vals = y[obs]
    if vals.size < 6:
        return []
    med = float(np.median(vals))
    mad = float(np.median(np.abs(vals - med))) * 1.4826
    if mad <= 0:
        return []
    out = []
    for i in np.where(obs)[0]:
        z = (y[i] - med) / mad
        if abs(z) > 4:
            out.append({"month": months[i], "value": float(y[i]), "z": round(float(z), 1)})
    return out


def analyze_series(
    y: np.ndarray,
    test_months: int,
    selection: str = "auto",
    rev: np.ndarray | None = None,
    tariffs_hist: np.ndarray | None = None,
) -> dict[str, Any]:
    """Bitta hudud × xizmat qatori: tarixiy test, model tanlash, prognoz va oraliq.

    rev — tarixiy haqiqiy daromad (so'm), tariffs_hist — o'sha oylardagi tarif (daromad xatosini hisoblash uchun).
    """
    n_obs = int(np.count_nonzero(~np.isnan(y)))
    result: dict[str, Any] = {
        "observations": n_obs,
        "intermittent": M.is_intermittent(y),
        "gaps": int(np.count_nonzero(np.isnan(y[np.argmax(~np.isnan(y)) :]))) if n_obs else 0,
        "zeroShare": float(np.mean(y[~np.isnan(y)] == 0)) if n_obs else None,
        "models": [],
        "notes": [],
    }
    if n_obs == 0:
        result.update(model=None, forecast=None, reliability="none", reason="Bu qator bo'yicha tarixiy ma'lumot yo'q")
        return result

    preds = backtest(y, test_months)
    cands = [c for c in M.candidates(y) if c in preds] if selection == "auto" else [selection]

    # Bir xil test oylari: hamma nomzodlarda bor oylar
    def common(names: list[str]) -> list[int]:
        if not names:
            return []
        keys = set(preds.get(names[0], {}).keys())
        for nm in names[1:]:
            keys &= set(preds.get(nm, {}).keys())
        return sorted(keys)

    comparable = True
    if selection == "auto":
        # Nuqtalari kam modelni chiqarib, qolganlarini teng sharoitda solishtirish
        cands = sorted(cands, key=lambda c: -len(preds.get(c, {})))
        while len(cands) > 1 and len(common(cands)) < MIN_COMMON_POINTS:
            dropped = min(cands, key=lambda c: (len(preds.get(c, {})), -M.COMPLEXITY.index(c)))
            cands.remove(dropped)
            result["notes"].append(f"{M.LABELS[dropped]}: tarixiy testda yetarli kuzatuv yo'q — solishtirilmadi")
        cands = sorted(cands, key=M.COMPLEXITY.index)
    keys = common(cands)
    if len(keys) < MIN_COMMON_POINTS:
        comparable = False

    table = []
    for name in M.COMPLEXITY:
        p = preds.get(name, {})
        own = sorted(p.keys())
        on_common = name in cands and bool(keys)
        use = keys if on_common else own
        a = np.array([y[k] for k in use])
        f = np.array([p[k] for k in use]) if use else np.array([])
        row: dict[str, Any] = {"model": name, "label": M.LABELS[name], "points": len(use), "candidate": name in cands, **metrics(a, f)}
        if rev is not None and tariffs_hist is not None and use:
            ra, rf = [], []
            for k in use:
                if not np.isnan(rev[k]) and not np.isnan(tariffs_hist[k]):
                    ra.append(rev[k])
                    rf.append(p[k] * tariffs_hist[k])
            rm = metrics(np.array(ra), np.array(rf))
            row["revMae"] = rm["mae"]
            row["revWape"] = rm["wape"]
        if p:
            table.append(row)
    result["models"] = table
    result["testPoints"] = len(keys)
    result["comparable"] = comparable

    # Tanlov: eng kichik WAPE; murakkab model sodda modeldan sezilarli (2% dan ko'p) yaxshi bo'lmasa — sodda
    chosen = None
    reason = ""
    scored = [r for r in table if r["candidate"] and r["wape"] is not None and r["points"] > 0]
    if selection != "auto":
        if not cands or M.forecast(selection, y) is None:
            result.update(model=None, forecast=None, reliability="none", reason=f"{M.LABELS.get(selection, selection)} bu qatorga qo'llanmaydi")
            return result
        chosen = selection
        reason = "Model foydalanuvchi tomonidan tanlangan"
    elif scored:
        best = min(r["wape"] for r in scored)
        for r in sorted(scored, key=lambda r: M.COMPLEXITY.index(r["model"])):
            if r["wape"] <= best * (1 + SIMPLER_TOLERANCE) + 1e-9:
                chosen = r["model"]
                break
        top = next(r for r in scored if r["model"] == chosen)
        better = [r for r in scored if r["wape"] < top["wape"] - 1e-9]
        reason = f"Tarixiy testda ({top['points']} oy) eng kichik xato: WAPE {top['wape']:.1f}%"
        if better:
            reason += f"; {', '.join(M.LABELS[r['model']] for r in better)} {min(r['wape'] for r in better):.1f}% — farq 2% dan kam, soddaroq model afzal"
    else:
        # Test oylarida haqiqiy qiymatlar 0 yoki test qilib bo'lmaydi
        simple = [c for c in M.COMPLEXITY if M.forecast(c, y) is not None]
        if not simple:
            result.update(model=None, forecast=None, reliability="none", reason="Prognoz uchun ma'lumot yetarli emas")
            return result
        chosen = simple[0]
        reason = (
            "Xatolikni hisoblash uchun haqiqiy qiymatlar yetarli emas — eng sodda model ishlatildi"
            if any(r["points"] for r in table)
            else "Tarixiy test uchun oylar yetarli emas — eng sodda model ishlatildi"
        )

    fit = M.forecast(chosen, y)
    if fit is None:
        result.update(model=None, forecast=None, reliability="none", reason="Prognoz uchun ma'lumot yetarli emas")
        return result
    top_row = next((r for r in table if r["model"] == chosen), None)
    wape = top_row["wape"] if top_row else None
    pts = top_row["points"] if top_row else 0

    # Noaniqlik: tanlangan modelning tarixiy xatolari kvantillari (80%)
    own = preds.get(chosen, {})
    resid = np.array([y[k] - own[k] for k in sorted(own)])
    interval = None
    if resid.size >= MIN_RESIDUALS_FOR_INTERVAL:
        lo, hi = np.quantile(resid, [0.1, 0.9])
        interval = {"lo": max(0.0, fit.forecast + float(lo)), "hi": max(0.0, fit.forecast + float(hi)), "level": 80, "basis": f"{resid.size} ta tarixiy xato kvantillari"}

    if wape is None or pts < MIN_COMMON_POINTS:
        reliability = "none"
    elif wape <= 15 and pts >= 4:
        reliability = "high"
    elif wape <= 30:
        reliability = "medium"
    else:
        reliability = "low"
    if not comparable and selection == "auto" and reliability != "none":
        result["notes"].append("Modellar to'liq bir xil sharoitda solishtirilmadi — kuzatuvlar kam")

    result.update(
        model=chosen,
        modelLabel=M.LABELS[chosen],
        params=fit.params,
        forecast=fit.forecast,
        interval=interval,
        wape=wape,
        reliability=reliability,
        reason=reason,
    )
    return result


# ───────────────────────── Butun hisoblash ─────────────────────────


RELIABILITY_LABEL = {"high": "Yuqori", "medium": "O'rta", "low": "Past", "none": "Aniqlanmagan"}


def largest_remainder(total: int, weights: list[float]) -> list[int]:
    """total ni og'irliklarga mutanosib butun sonlarga bo'ladi; yig'indi aynan total."""
    s = sum(weights)
    if total == 0 or s <= 0:
        return [0] * len(weights)
    raw = [total * w / s for w in weights]
    base = [math.floor(r) for r in raw]
    rest = total - sum(base)
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - base[i]), i))
    for i in order[:rest]:
        base[i] += 1
    return base


def compute(body: dict[str, Any]) -> dict[str, Any]:
    """Asosiy hisob: hamma hudud × xizmat qatorlari, hudud jamilari va xodimlar rejasi."""
    from .allocate import allocate_region

    target: str = body["targetPeriod"]
    months: list[str] = body["months"]
    opts = body.get("options", {})
    test_months = int(opts.get("backtestMonths", 6))
    selection = str(opts.get("selection", "auto"))
    round_qty = bool(opts.get("roundQuantity", True))
    if selection != "auto" and selection not in M.MODELS:
        raise ValueError("Model noma'lum")
    if not months or months[-1] >= target:
        raise ValueError("Tarixiy davr prognoz oyidan oldin tugashi kerak")
    if period_add(months[-1], 1) != target:
        raise ValueError(f"Tarix {months[-1]} da tugaydi — prognoz oyi {period_add(months[-1], 1)} bo'lishi kerak (1 oy oldinga)")

    book = TariffBook(body.get("tariffs", []))
    regions: dict[int, dict[str, Any]] = {}
    services_meta = {s["code"]: s for s in body.get("services", [])}
    region_names = {int(r["code"]): r["name"] for r in body.get("regions", [])}

    for item in body["series"]:
        h, s = int(item["region"]), str(item["service"])
        y = np.array([np.nan if v is None else float(v) for v in item["qty"]], dtype=float)
        rev = np.array([np.nan if v is None else float(v) for v in item.get("rev", [None] * len(months))], dtype=float)
        hist_t = np.array([book.at(s, h, m) if book.at(s, h, m) is not None else np.nan for m in months], dtype=float)
        res = analyze_series(y, test_months, selection, rev, hist_t)

        tariff = book.at(s, h, target)
        tariff_source = "catalog"
        if tariff is None:
            # Katalogda tarif yo'q — oxirgi oylardagi haqiqiy o'rtacha narx (daromad ÷ soni)
            ok = [(rev[i], y[i]) for i in range(len(months) - 1, max(-1, len(months) - 7), -1) if not np.isnan(rev[i]) and not np.isnan(y[i]) and y[i] > 0]
            if ok:
                tariff = sum(r for r, _ in ok) / sum(q for _, q in ok)
                tariff_source = "implied"
        qf = res.get("forecast")
        q_final = None if qf is None else (float(round(qf)) if round_qty else float(qf))
        revenue = None if q_final is None or tariff is None else int(round(q_final * tariff))

        # Daromad va soni × tarif farqi (oxirgi 12 oy)
        gap = None
        idx = [i for i in range(max(0, len(months) - 12), len(months)) if not np.isnan(rev[i]) and not np.isnan(y[i]) and not np.isnan(hist_t[i])]
        if idx:
            recorded = float(sum(rev[i] for i in idx))
            formula = float(sum(y[i] * hist_t[i] for i in idx))
            gap = {"recorded": recorded, "formula": formula, "diff": recorded - formula, "pct": (recorded - formula) / formula * 100 if formula else None}

        last_i = len(months) - 1
        series_out = {
            "service": s,
            "serviceName": services_meta.get(s, {}).get("name", s),
            "lastQty": None if np.isnan(y[last_i]) else float(y[last_i]),
            "lastRev": None if np.isnan(rev[last_i]) else float(rev[last_i]),
            "prevQty": None if last_i < 1 or np.isnan(y[last_i - 1]) else float(y[last_i - 1]),
            "prevRev": None if last_i < 1 or np.isnan(rev[last_i - 1]) else float(rev[last_i - 1]),
            "lyRev": None if last_i < 11 or np.isnan(rev[last_i - 11]) else float(rev[last_i - 11]),
            "history": {"qty": [None if np.isnan(v) else float(v) for v in y], "rev": [None if np.isnan(v) else float(v) for v in rev]},
            "forecastQty": qf,
            "forecastQtyFinal": q_final,
            "tariff": tariff,
            "tariffSource": tariff_source if tariff is not None else None,
            "forecastRev": revenue,
            "revInterval": None
            if res.get("interval") is None or tariff is None
            else {"lo": int(round(res["interval"]["lo"] * tariff)), "hi": int(round(res["interval"]["hi"] * tariff)), "level": 80},
            "formulaGap": gap,
            "outliers": detect_outliers(y, months),
            **{k: v for k, v in res.items() if k not in ("forecast",)},
        }
        reg = regions.setdefault(h, {"region": h, "regionName": region_names.get(h, str(h)), "services": []})
        reg["services"].append(series_out)

    # Hudud jamilari: faqat xizmatlar yig'indisidan
    out_regions = []
    for h, reg in sorted(regions.items()):
        svc = reg["services"]
        have = [x for x in svc if x["forecastRev"] is not None]
        reg["forecastRev"] = int(sum(x["forecastRev"] for x in have))
        reg["servicesForecast"] = len(have)
        reg["servicesMissing"] = [x["service"] for x in svc if x["forecastRev"] is None and (x["observations"] or 0) > 0]
        reg["servicesNoData"] = [x["service"] for x in svc if (x["observations"] or 0) == 0]
        last = [x["lastRev"] for x in svc if x["lastRev"] is not None]
        reg["lastRev"] = float(sum(last)) if last else None
        prev = [x["prevRev"] for x in svc if x["prevRev"] is not None]
        reg["prevRev"] = float(sum(prev)) if prev else None
        # Hudud bo'yicha tarixiy daromad xatosi: tanlangan modellarning test oylaridagi yig'indisi
        reg["accuracy"] = region_accuracy(svc, months, test_months)
        reg["history"] = {
            "rev": [float(sum(x["history"]["rev"][i] or 0 for x in svc)) if any(x["history"]["rev"][i] is not None for x in svc) else None for i in range(len(months))],
        }
        reg["intervalNote"] = "Hudud jami oraliq hisoblanmaydi — xizmatlar xatolari o'zaro bog'liq bo'lishi mumkin"
        out_regions.append(reg)

    total = int(sum(r["forecastRev"] for r in out_regions))
    # Xodimlar rejasi
    alloc_in = body.get("allocation") or {}
    for reg in out_regions:
        data = (alloc_in.get("regions") or {}).get(str(reg["region"]))
        if data is not None:
            reg["employees"] = allocate_region(reg, data, alloc_in, months, target)

    return {
        "targetPeriod": target,
        "months": months,
        "options": {"backtestMonths": test_months, "selection": selection, "roundQuantity": round_qty},
        "total": {
            "forecastRev": total,
            "lastRev": sum(r["lastRev"] or 0 for r in out_regions) if any(r["lastRev"] is not None for r in out_regions) else None,
            "accuracy": combine_accuracy([r["accuracy"] for r in out_regions]),
        },
        "regions": out_regions,
        "modelLabels": M.LABELS,
    }


def region_accuracy(services: list[dict[str, Any]], months: list[str], test_months: int) -> dict[str, Any]:
    """Hudud jami daromadi bo'yicha tarixiy xato: tanlangan modellar prognozlari × tarif, oylar bo'yicha yig'ilgan."""
    # Har bir xizmatning tanlangan modeli bo'yicha test oylari prognozini qayta hisoblaymiz (faqat o'tmish ma'lumoti)
    n = len(months)
    start = max(3, n - test_months)
    act = np.zeros(n)
    fc = np.zeros(n)
    used = np.zeros(n, dtype=bool)
    for x in services:
        name = x.get("model")
        if not name:
            continue
        y = np.array([np.nan if v is None else v for v in x["history"]["qty"]], dtype=float)
        rev = np.array([np.nan if v is None else v for v in x["history"]["rev"]], dtype=float)
        price = x.get("tariff")
        for k in range(start, n):
            if np.isnan(y[k]) or np.isnan(rev[k]):
                continue
            fit = M.forecast(name, y[:k])
            if fit is None:
                continue
            # Tarixiy oy uchun: shu oydagi haqiqiy o'rtacha narx (yo'q bo'lsa — joriy tarif)
            p = rev[k] / y[k] if y[k] > 0 else price
            if p is None:
                continue
            act[k] += rev[k]
            fc[k] += fit.forecast * p
            used[k] = True
    ks = [k for k in range(start, n) if used[k]]
    m = metrics(act[ks], fc[ks]) if ks else metrics(np.array([]), np.array([]))
    return {"points": len(ks), "months": [months[k] for k in ks], "actual": [float(act[k]) for k in ks], "forecast": [float(fc[k]) for k in ks], **m}


def combine_accuracy(items: list[dict[str, Any]]) -> dict[str, Any]:
    by: dict[str, list[float]] = {}
    for it in items:
        for mth, a, f in zip(it.get("months", []), it.get("actual", []), it.get("forecast", [])):
            cur = by.setdefault(mth, [0.0, 0.0])
            cur[0] += a
            cur[1] += f
    ks = sorted(by)
    if not ks:
        return {"points": 0, **metrics(np.array([]), np.array([]))}
    a = np.array([by[k][0] for k in ks])
    f = np.array([by[k][1] for k in ks])
    return {"points": len(ks), "months": ks, "actual": a.tolist(), "forecast": f.tolist(), **metrics(a, f)}