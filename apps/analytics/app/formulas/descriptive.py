"""1-daraja: tavsifiy formulalar va oddiy bog'liqlik."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as sps

from ..dataset import METRICS, NO_REGION, monthly
from .base import (
    Formula,
    Param,
    Result,
    RunParams,
    clean,
    fmt_money,
    fmt_number,
    fmt_percent,
    fmt_period,
    fmt_value,
    full_money,
    make_calc,
    num_text,
    q,
    q_unit,
    register,
    safe_div,
)

METRIC_KEYS = list(METRICS.keys())
MONEY_METRICS = [k for k, m in METRICS.items() if m.unit == "som"]


def _metric(key: str):
    if key not in METRICS:
        raise ValueError(f"Ko'rsatkich noto'g'ri: {key}")
    return METRICS[key]


def _series_chart(x: list[str], series: list[tuple[str, list[float], str]], kind: str = "line") -> dict:
    return {
        "type": kind,
        "x": x,
        "series": [{"name": name, "values": [clean(v) for v in values], "unit": unit} for name, values, unit in series],
    }


# ═══════════════════════════════════════════════════════════
# 1. O'sish sur'ati
# ═══════════════════════════════════════════════════════════


def run_growth(panel: pd.DataFrame, p: RunParams) -> Result:
    metric = _metric(p.metric)
    data = monthly(panel, p.start, p.end)
    values = data[metric.key].astype(float).tolist()
    periods = data["period"].tolist()
    result = Result(n=len(values))

    if len(values) < 2 or sum(1 for v in values if v) < 2:
        result.insufficient = True
        result.warnings.append("O'sishni hisoblash uchun kamida 2 oylik ma'lumot kerak")
        return result

    growth: list[float | None] = [None]
    for prev, cur in zip(values[:-1], values[1:]):
        rate = safe_div(cur - prev, prev)
        growth.append(rate * 100 if rate is not None else None)

    first_index = next(i for i, v in enumerate(values) if v)
    last_index = max(i for i, v in enumerate(values) if v)
    first, last = values[first_index], values[last_index]
    steps = last_index - first_index
    cagr = ((last / first) ** (1 / steps) - 1) * 100 if steps > 0 and first > 0 and last > 0 else None
    total_change = safe_div(last - first, first)

    valid = [(periods[i], g) for i, g in enumerate(growth) if g is not None]
    top = max(valid, key=lambda item: item[1]) if valid else None
    bottom = min(valid, key=lambda item: item[1]) if valid else None
    zero_months = [periods[i] for i, v in enumerate(values) if not v]

    result.headline = {
        "label": "O'rtacha oylik o'sish (CAGR)",
        "value": clean(cagr),
        "unit": "percent",
        "text": fmt_percent(cagr, 2, sign=True),
    }
    result.stats = [
        {"label": f"Boshlang'ich ({fmt_period(periods[first_index])})", "value": clean(first), "unit": metric.unit, "text": fmt_value(first, metric.unit)},
        {"label": f"Oxirgi ({fmt_period(periods[last_index])})", "value": clean(last), "unit": metric.unit, "text": fmt_value(last, metric.unit)},
        {"label": "Umumiy o'zgarish", "value": clean(total_change * 100 if total_change is not None else None), "unit": "percent",
         "text": fmt_percent(total_change * 100 if total_change is not None else None, 1, sign=True)},
    ]
    if top:
        result.stats.append({"label": f"Eng katta o'sish — {fmt_period(top[0])}", "value": clean(top[1]), "unit": "percent", "text": fmt_percent(top[1], 1, sign=True)})
    if bottom:
        result.stats.append({"label": f"Eng katta pasayish — {fmt_period(bottom[0])}", "value": clean(bottom[1]), "unit": "percent", "text": fmt_percent(bottom[1], 1, sign=True)})

    u = metric.unit
    if cagr is not None:
        result.headline["calc"] = make_calc(
            "O'rtacha oylik o'sish (CAGR)",
            "CAGR = (Oxirgi ÷ Boshlang'ich)^(1 ÷ oylar farqi) − 1",
            [q_unit(f"Boshlang'ich ({fmt_period(periods[first_index])})", first, u), q_unit(f"Oxirgi ({fmt_period(periods[last_index])})", last, u), q("Oylar farqi", steps, "count")],
            [
                f"Nisbat = {num_text(last, u)} ÷ {num_text(first, u)} = {fmt_number(last / first, 4)}",
                f"Daraja = 1 ÷ {steps} = {fmt_number(1 / steps, 4)}",
                f"{fmt_number(last / first, 4)}^{fmt_number(1 / steps, 4)} = {fmt_number((last / first) ** (1 / steps), 6)}",
                f"CAGR = ({fmt_number((last / first) ** (1 / steps), 6)} − 1) × 100 = {fmt_percent(cagr, 2, sign=True)}",
            ],
            fmt_percent(cagr, 2, sign=True),
            "Har oy shu sur'atda o'zgarganda boshlang'ich qiymat oxirgisiga yetadi.",
        )
    if total_change is not None:
        result.stats[2]["calc"] = make_calc(
            "Umumiy o'zgarish",
            "O'zgarish = (Oxirgi − Boshlang'ich) ÷ Boshlang'ich × 100",
            [q_unit("Oxirgi", last, u), q_unit("Boshlang'ich", first, u)],
            [f"= ({num_text(last, u)} − {num_text(first, u)}) ÷ {num_text(first, u)} × 100", f"= {fmt_number(last - first, 2 if u != 'som' else 0)} ÷ {num_text(first, u)} × 100", f"= {fmt_percent(total_change * 100, 1, sign=True)}"],
            fmt_percent(total_change * 100, 1, sign=True),
        )
    for stat, item in ((result.stats[3] if top and len(result.stats) > 3 else None, top), (result.stats[-1] if bottom else None, bottom)):
        if stat is None or item is None:
            continue
        i = periods.index(item[0])
        stat["calc"] = make_calc(
            f"{fmt_period(item[0])}: oylik o'sish",
            "g = (Shu oy − O'tgan oy) ÷ O'tgan oy × 100",
            [q_unit(fmt_period(periods[i]), values[i], u), q_unit(fmt_period(periods[i - 1]), values[i - 1], u)],
            [f"= ({num_text(values[i], u)} − {num_text(values[i - 1], u)}) ÷ {num_text(values[i - 1], u)} × 100", f"= {fmt_percent(item[1], 1, sign=True)}"],
            fmt_percent(item[1], 1, sign=True),
        )

    result.chart = {
        **_series_chart(periods, [(metric.label, values, metric.unit)], "bar"),
        "overlay": {"name": "Oylik o'sish, %", "values": [clean(g) for g in growth], "unit": "percent"},
    }
    result.table = {
        "columns": [
            {"key": "period", "label": "Oy", "unit": "period"},
            {"key": "value", "label": metric.label, "unit": metric.unit},
            {"key": "growth", "label": "O'sish, %", "unit": "percent"},
        ],
        "rows": [{"period": per, "value": clean(v), "growth": clean(g)} for per, v, g in zip(periods, values, growth)],
    }

    direction = "o'sgan" if last > first else "kamaygan"
    good = (last > first) == metric.higher_is_better
    result.interpretation.append(
        f"{metric.label} {fmt_period(periods[first_index])}dagi {fmt_value(first, metric.unit)}dan "
        f"{fmt_period(periods[last_index])}dagi {fmt_value(last, metric.unit)}gacha {direction} "
        f"({fmt_percent(total_change * 100 if total_change is not None else None, 1, sign=True)})."
    )
    if cagr is not None and abs(cagr) < 0.5:
        result.interpretation.append("O'rtacha oylik o'zgarish 0,5% dan kam — ko'rsatkich deyarli o'zgarmagan.")
    elif cagr is not None:
        result.interpretation.append(
            f"Bu har oy o'rtacha {fmt_percent(abs(cagr), 2)} {'o‘sish' if cagr >= 0 else 'kamayish'} demakdir "
            f"— {'ijobiy' if good else 'e’tibor talab qiladigan'} holat."
        )
    if top and bottom and top[0] != bottom[0]:
        result.interpretation.append(
            f"Eng keskin sakrash {fmt_period(top[0])}da ({fmt_percent(top[1], 1, sign=True)}), "
            f"eng katta tushish {fmt_period(bottom[0])}da ({fmt_percent(bottom[1], 1, sign=True)}) bo'lgan."
        )
    if zero_months:
        result.warnings.append(
            "Ma'lumot yo'q oylar: " + ", ".join(fmt_period(x) for x in zero_months[:6])
            + (" va boshqalar" if len(zero_months) > 6 else "") + " — o'sish ular bo'yicha hisoblanmadi"
        )
    return result


register(
    Formula(
        id="growth",
        title="O'sish sur'ati",
        category="Tavsifiy",
        description="Ko'rsatkich oyma-oy qanchaga o'zgargani va butun davr bo'yicha o'rtacha oylik o'sish (CAGR).",
        latex=r"g_t = \frac{X_t - X_{t-1}}{X_{t-1}} \times 100\%,\qquad CAGR = \left(\frac{X_T}{X_1}\right)^{\frac{1}{T-1}} - 1",
        symbols={"X_t": "t oydagi qiymat", "g_t": "t oydagi o'sish", "T": "oylar soni", "CAGR": "o'rtacha oylik o'sish"},
        params=[Param("metric", "Ko'rsatkich", "metric", "expense_total", METRIC_KEYS)],
        min_periods=2,
        run=run_growth,
    )
)

# ═══════════════════════════════════════════════════════════
# 2. Tarkib ulushi
# ═══════════════════════════════════════════════════════════

GROUPS = {
    "section": ("Bo'lim", [("expense_doimiy", "Doimiy"), ("expense_boshqa", "Boshqa")]),
    "type": ("Xarajat turi", [("expense_payroll", "Ish haqi"), ("expense_lease", "Ijara"), ("expense_other", "Qolgan xarajatlar")]),
}


def _components(panel: pd.DataFrame, p: RunParams) -> tuple[str, pd.DataFrame]:
    """Guruh bo'yicha komponentlar: period × komponent → summa."""
    data = monthly(panel, p.start, p.end)
    if p.group_by == "region":
        if panel.empty:
            return "Hudud", pd.DataFrame(columns=["period", "name", "value"])
        rows = panel.groupby(["period", "region_name"], as_index=False)["expense_total"].sum()
        return "Hudud", rows.rename(columns={"region_name": "name", "expense_total": "value"})
    if p.group_by not in GROUPS:
        raise ValueError(f"Guruh noto'g'ri: {p.group_by}")
    title, parts = GROUPS[p.group_by]
    frames = [pd.DataFrame({"period": data["period"], "name": label, "value": data[col]}) for col, label in parts]
    return title, pd.concat(frames, ignore_index=True)


def run_share(panel: pd.DataFrame, p: RunParams) -> Result:
    title, comp = _components(panel, p)
    result = Result()
    total = float(comp["value"].sum()) if not comp.empty else 0.0
    if total <= 0:
        result.insufficient = True
        result.warnings.append("Tanlangan davrda xarajat yo'q")
        return result

    periods = sorted(comp["period"].unique())
    active = [per for per in periods if comp.loc[comp["period"] == per, "value"].sum() > 0]
    first_p, last_p = active[0], active[-1]

    def shares(period: str | None) -> pd.Series:
        rows = comp if period is None else comp[comp["period"] == period]
        sums = rows.groupby("name")["value"].sum()
        whole = sums.sum()
        return (sums / whole * 100) if whole > 0 else sums * 0

    overall = comp.groupby("name")["value"].sum().sort_values(ascending=False)
    share_all = shares(None)
    share_first = shares(first_p)
    share_last = shares(last_p)
    result.n = len(active)

    rows = []
    for name, value in overall.items():
        s_first = float(share_first.get(name, 0.0))
        s_last = float(share_last.get(name, 0.0))
        rows.append({
            "name": name,
            "value": clean(float(value)),
            "share": clean(float(share_all.get(name, 0.0))),
            "shareFirst": clean(s_first),
            "shareLast": clean(s_last),
            "shift": clean(s_last - s_first),
        })

    leader = rows[0]
    result.headline = {"label": f"Eng katta ulush — {leader['name']}", "value": leader["share"], "unit": "percent", "text": fmt_percent(leader["share"])}
    result.headline["calc"] = make_calc(
        f"{leader['name']}: ulush",
        "Ulush = Qism summasi ÷ Jami × 100",
        [q(leader["name"], leader["value"]), q("Jami", total)],
        [f"= {fmt_number(round(leader['value']))} ÷ {fmt_number(round(total))} × 100", f"= {fmt_number(leader['value'] / total, 4)} × 100", f"= {fmt_percent(leader['share'])}"],
        fmt_percent(leader["share"]),
    )
    result.stats = [
        {"label": "Jami", "value": clean(total), "unit": "som", "text": fmt_money(total),
         "calc": make_calc("Jami", "Jami = qismlar yig'indisi", [q(r["name"], r["value"]) for r in rows],
                           [" + ".join(fmt_number(round(r["value"])) for r in rows[:12]) + (" + …" if len(rows) > 12 else ""), f"= {full_money(total)}"], full_money(total))},
        {"label": "Tarkibiy qismlar", "value": len(rows), "unit": "count", "text": str(len(rows))},
    ]
    result.chart = {
        "type": "pie",
        "x": [r["name"] for r in rows],
        "series": [{"name": "Ulush, %", "values": [r["share"] for r in rows], "unit": "percent"}],
    }
    result.table = {
        "columns": [
            {"key": "name", "label": title, "unit": "text"},
            {"key": "value", "label": "Summa", "unit": "som"},
            {"key": "share", "label": "Ulush, %", "unit": "percent"},
            {"key": "shareFirst", "label": f"{fmt_period(first_p)}", "unit": "percent"},
            {"key": "shareLast", "label": f"{fmt_period(last_p)}", "unit": "percent"},
            {"key": "shift", "label": "Siljish, p.p.", "unit": "pp"},
        ],
        "rows": rows,
    }

    result.interpretation.append(
        f"Tanlangan davrdagi jami xarajatning {fmt_percent(leader['share'])}i «{leader['name']}»ga to'g'ri keladi ({fmt_money(leader['value'])})."
    )
    if first_p != last_p:
        mover = max(rows, key=lambda r: abs(r["shift"] or 0))
        if abs(mover["shift"] or 0) >= 1:
            verb = "oshgan" if (mover["shift"] or 0) > 0 else "kamaygan"
            result.interpretation.append(
                f"{fmt_period(first_p)} bilan {fmt_period(last_p)} solishtirilganda «{mover['name']}» ulushi "
                f"{fmt_number(abs(mover['shift']), 1)} foiz punktga {verb} — tuzilmadagi eng katta siljish."
            )
        else:
            result.interpretation.append("Davr boshi va oxirida tuzilma deyarli o'zgarmagan (siljish 1 foiz punktdan kam).")
    return result


register(
    Formula(
        id="share",
        title="Tarkib ulushi",
        category="Tavsifiy",
        description="Xarajat qaysi qismlardan tashkil topgani va davr davomida tuzilma qanday siljigani.",
        latex=r"s_i = \frac{X_i}{\sum_{j} X_j} \times 100\%,\qquad \Delta s_i = s_i^{\,oxirgi} - s_i^{\,birinchi}",
        symbols={"X_i": "i-qism summasi", "s_i": "i-qism ulushi", "Δs_i": "ulush siljishi (foiz punkt)"},
        params=[Param("group_by", "Guruhlash", "group", "section", ["section", "type", "region"])],
        min_periods=1,
        run=run_share,
    )
)

# ═══════════════════════════════════════════════════════════
# 3. Bir xodimga
# ═══════════════════════════════════════════════════════════


def run_per_employee(panel: pd.DataFrame, p: RunParams) -> Result:
    metric = _metric(p.metric)
    if metric.unit != "som":
        raise ValueError("Bir xodimga hisob faqat pul ko'rsatkichlari uchun")
    data = monthly(panel, p.start, p.end)
    result = Result()
    staffed = data[data["headcount"] > 0]
    if staffed.empty:
        result.insufficient = True
        result.warnings.append("Xodimlar soni noma'lum — tanlangan davr uchun ish haqi yuklanmagan")
        return result

    per = (data[metric.key] / data["headcount"].replace(0, np.nan)).tolist()
    periods = data["period"].tolist()
    valid = [(periods[i], v) for i, v in enumerate(per) if v is not None and not math.isnan(v)]
    result.n = len(valid)
    avg = float(staffed[metric.key].sum() / staffed["headcount"].sum())
    first_v, last_v = valid[0][1], valid[-1][1]
    change = safe_div(last_v - first_v, first_v)

    total_sum = float(staffed[metric.key].sum())
    total_heads = float(staffed["headcount"].sum())
    result.headline = {"label": f"{metric.label} — bir xodimga (oyiga)", "value": clean(avg), "unit": "som", "text": fmt_money(avg),
                       "calc": make_calc(
                           f"{metric.label} — bir xodimga (oyiga)",
                           "Bir xodimga = Σ summa ÷ Σ xodimlar (har oy xodimlari qo'shiladi — «xodim-oy»)",
                           [q(f"{fmt_period(r.period)}: summa", float(getattr(r, metric.key))) for r in staffed.itertuples()]
                           + [q(f"{fmt_period(r.period)}: xodimlar", float(r.headcount), "count") for r in staffed.itertuples()],
                           [f"Σ summa = {full_money(total_sum)}", f"Σ xodimlar = {fmt_number(total_heads)} xodim-oy", f"= {fmt_number(round(total_sum))} ÷ {fmt_number(total_heads)}", f"= {full_money(avg)}"],
                           full_money(avg),
                           "Xodimi ma'lum oylar olinadi (ish haqi yuklangan oylar).",
                       )}
    result.stats = [
        {"label": "O'rtacha xodimlar soni", "value": clean(float(staffed["headcount"].mean())), "unit": "kishi", "text": f"{fmt_number(float(staffed['headcount'].mean()))} kishi"},
        {"label": f"{fmt_period(valid[0][0])}", "value": clean(first_v), "unit": "som", "text": fmt_money(first_v)},
        {"label": f"{fmt_period(valid[-1][0])}", "value": clean(last_v), "unit": "som", "text": fmt_money(last_v)},
        {"label": "O'zgarish", "value": clean(change * 100 if change is not None else None), "unit": "percent", "text": fmt_percent(change * 100 if change is not None else None, 1, sign=True),
         **({"calc": make_calc("O'zgarish", "O'zgarish = (Oxirgi − Birinchi) ÷ Birinchi × 100",
                               [q(fmt_period(valid[-1][0]), last_v), q(fmt_period(valid[0][0]), first_v)],
                               [f"= ({fmt_number(round(last_v))} − {fmt_number(round(first_v))}) ÷ {fmt_number(round(first_v))} × 100", f"= {fmt_percent(change * 100, 1, sign=True)}"],
                               fmt_percent(change * 100, 1, sign=True))} if change is not None else {})},
    ]
    result.chart = _series_chart(periods, [("Bir xodimga", per, "som")], "line")

    # Hududlar kesimi: davr jami / o'rtacha xodimlar
    regional = panel[(panel["headcount"] > 0) & (panel["region_code"] != NO_REGION)]
    rows = []
    if not regional.empty:
        grouped = regional.groupby("region_name").agg(value=(metric.key, "sum"), headcount=("headcount", "mean"), months=("period", "nunique"))
        grouped["perHead"] = grouped["value"] / grouped["months"] / grouped["headcount"]
        grouped = grouped.sort_values("perHead", ascending=False)
        rows = [
            {"name": name, "headcount": clean(float(r.headcount)), "value": clean(float(r.value)), "perHead": clean(float(r.perHead))}
            for name, r in grouped.iterrows()
        ]
    result.table = {
        "columns": [
            {"key": "name", "label": "Hudud", "unit": "text"},
            {"key": "headcount", "label": "O'rtacha xodim", "unit": "kishi"},
            {"key": "value", "label": metric.label, "unit": "som"},
            {"key": "perHead", "label": "Bir xodimga, oyiga", "unit": "som"},
        ],
        "rows": rows,
    }

    result.interpretation.append(
        f"Tanlangan davrda bir xodimga oyiga o'rtacha {fmt_money(avg)} {metric.label.lower()} to'g'ri kelgan."
    )
    if change is not None and len(valid) > 1 and abs(change) < 0.005:
        result.interpretation.append(
            f"{fmt_period(valid[0][0])}dan {fmt_period(valid[-1][0])}gacha bu ko'rsatkich deyarli o'zgarmagan."
        )
    elif change is not None and len(valid) > 1:
        result.interpretation.append(
            f"{fmt_period(valid[0][0])}dan {fmt_period(valid[-1][0])}gacha bu ko'rsatkich {fmt_percent(abs(change * 100), 1)} "
            f"{'oshgan' if change > 0 else 'kamaygan'}."
        )
    if len(rows) >= 2:
        hi, lo = rows[0], rows[-1]
        ratio = safe_div(hi["perHead"] or 0, lo["perHead"] or 0)
        result.interpretation.append(
            f"Eng yuqori — {hi['name']} ({fmt_money(hi['perHead'])}), eng past — {lo['name']} ({fmt_money(lo['perHead'])})"
            + (f"; farq {fmt_number(ratio, 1)} baravar." if ratio else ".")
        )
    return result


register(
    Formula(
        id="per_employee",
        title="Bir xodimga to'g'ri keladigan",
        category="Tavsifiy",
        description="Xarajat, ish haqi yoki daromadning bir xodimga oylik miqdori — oylar va hududlar bo'yicha.",
        latex=r"\bar{x}_t = \frac{X_t}{L_t}",
        symbols={"X_t": "t oydagi summa", "L_t": "t oydagi xodimlar soni", "x̄_t": "bir xodimga"},
        params=[Param("metric", "Ko'rsatkich", "metric", "payroll_total", MONEY_METRICS)],
        min_periods=1,
        run=run_per_employee,
    )
)

# ═══════════════════════════════════════════════════════════
# 4. Ish haqi / daromad
# ═══════════════════════════════════════════════════════════


def run_payroll_ratio(panel: pd.DataFrame, p: RunParams) -> Result:
    data = monthly(panel, p.start, p.end)
    result = Result()
    wages = data["payroll_total"].where(data["payroll_total"] > 0, data["expense_payroll"])
    income = data["income_total"]
    mask = income > 0
    if not mask.any():
        result.insufficient = True
        result.warnings.append("Tanlangan davrda daromad yozuvlari yo'q — nisbatni hisoblab bo'lmaydi")
        return result

    ratio = (wages / income.replace(0, np.nan) * 100).tolist()
    periods = data["period"].tolist()
    total_ratio = float(wages[mask].sum() / income[mask].sum() * 100)
    result.n = int(mask.sum())
    w_sum = float(wages[mask].sum())
    i_sum = float(income[mask].sum())
    result.headline = {"label": "Ish haqi / daromad", "value": clean(total_ratio), "unit": "percent", "text": fmt_percent(total_ratio),
                       "calc": make_calc(
                           "Ish haqi / daromad",
                           "Nisbat = Σ ish haqi ÷ Σ daromad × 100 (daromadi bor oylar)",
                           [q("Σ ish haqi", w_sum, source="Ish haqi qaydnomasi"), q("Σ daromad", i_sum, source="Daromad yozuvlari")],
                           [f"= {fmt_number(round(w_sum))} ÷ {fmt_number(round(i_sum))} × 100", f"= {fmt_number(w_sum / i_sum, 4)} × 100", f"= {fmt_percent(total_ratio)}"],
                           fmt_percent(total_ratio),
                           "25% gacha — past, 25–50% — me'yorda, 50–70% — yuqori, 70% dan ortiq — juda yuqori.",
                       )}
    result.stats = [
        {"label": "Ish haqi", "value": clean(float(wages[mask].sum())), "unit": "som", "text": fmt_money(float(wages[mask].sum()))},
        {"label": "Daromad", "value": clean(float(income[mask].sum())), "unit": "som", "text": fmt_money(float(income[mask].sum()))},
    ]
    result.chart = _series_chart(periods, [("Ish haqi / daromad, %", ratio, "percent")], "line")
    result.interpretation.append(
        f"Har 100 so'm daromadning {fmt_number(total_ratio, 1)} so'mi ish haqiga ketgan."
    )
    level = "juda yuqori — rentabellik xavf ostida" if total_ratio > 70 else "yuqori" if total_ratio > 50 else "me'yorda" if total_ratio > 25 else "past"
    result.interpretation.append(f"Bu ulush {level} darajada.")
    return result


register(
    Formula(
        id="payroll_ratio",
        title="Ish haqi / daromad nisbati",
        category="Tavsifiy",
        description="Daromadning qancha qismi ish haqiga sarflanishi (mehnat sig'imi).",
        latex=r"w_t = \frac{W_t}{R_t} \times 100\%",
        symbols={"W_t": "t oydagi ish haqi", "R_t": "t oydagi daromad", "w_t": "ish haqi ulushi"},
        params=[],
        min_periods=1,
        run=run_payroll_ratio,
    )
)

# ═══════════════════════════════════════════════════════════
# 5. Konsentratsiya (HHI)
# ═══════════════════════════════════════════════════════════


def run_hhi(panel: pd.DataFrame, p: RunParams) -> Result:
    title, comp = _components(panel, p)
    result = Result()
    sums = comp.groupby("name")["value"].sum() if not comp.empty else pd.Series(dtype=float)
    sums = sums[sums > 0]
    if sums.empty:
        result.insufficient = True
        result.warnings.append("Tanlangan davrda xarajat yo'q")
        return result

    shares = sums / sums.sum() * 100
    hhi = float((shares**2).sum())
    effective = 10000 / hhi if hhi > 0 else None
    result.n = len(sums)
    level = "yuqori" if hhi > 2500 else "o'rtacha" if hhi > 1500 else "past"
    ordered_for_calc = shares.sort_values(ascending=False)
    result.headline = {"label": "HHI indeksi", "value": clean(hhi), "unit": "index", "text": fmt_number(hhi),
                       "calc": make_calc(
                           "HHI indeksi",
                           "HHI = Σ (ulush, %)²",
                           [q(f"{k} ulushi", float(v), "pct") for k, v in ordered_for_calc.items()],
                           [" + ".join(f"{fmt_number(float(v), 1)}²" for v in list(ordered_for_calc)[:10]) + (" + …" if len(ordered_for_calc) > 10 else ""),
                            "= " + " + ".join(fmt_number(float(v) ** 2) for v in list(ordered_for_calc)[:10]) + (" + …" if len(ordered_for_calc) > 10 else ""),
                            f"= {fmt_number(hhi)}",
                            f"Samarali qismlar = 10 000 ÷ {fmt_number(hhi)} = {fmt_number(effective or 0, 1)}"],
                           fmt_number(hhi),
                           "1500 dan past — tarqoq, 1500–2500 — o'rtacha, 2500 dan yuqori — bir joyga to'plangan.",
                       )}
    result.stats = [
        {"label": "Konsentratsiya", "value": level, "unit": "text", "text": level},
        {"label": "Samarali qismlar soni", "value": clean(effective), "unit": "count", "text": fmt_number(effective or 0, 1)},
        {"label": "Haqiqiy qismlar soni", "value": len(sums), "unit": "count", "text": str(len(sums))},
    ]
    ordered = shares.sort_values(ascending=False)
    result.chart = {"type": "bar", "x": list(ordered.index), "series": [{"name": "Ulush, %", "values": [clean(float(v)) for v in ordered], "unit": "percent"}]}
    result.table = {
        "columns": [
            {"key": "name", "label": title, "unit": "text"},
            {"key": "share", "label": "Ulush, %", "unit": "percent"},
            {"key": "square", "label": "Ulush²", "unit": "index"},
        ],
        "rows": [{"name": k, "share": clean(float(v)), "square": clean(float(v) ** 2)} for k, v in ordered.items()],
    }
    result.interpretation.append(
        f"HHI = {fmt_number(hhi)} — xarajatlar {title.lower()} bo'yicha {level} darajada jamlangan "
        f"(1500 dan past — tarqoq, 2500 dan yuqori — bir joyga to'plangan)."
    )
    if effective and effective >= 0.9 * len(sums):
        result.interpretation.append(
            f"Xarajatlar {len(sums)} ta qism o'rtasida deyarli tekis taqsimlangan."
        )
    elif effective:
        result.interpretation.append(
            f"Amalda xarajatlar {fmt_number(effective, 1)} ta teng qismga bo'lingandek taqsimlangan, "
            f"garchi qismlar soni {len(sums)} ta bo'lsa ham."
        )
    return result


register(
    Formula(
        id="hhi",
        title="Konsentratsiya indeksi (HHI)",
        category="Tavsifiy",
        description="Xarajatlar bir-ikki joyga to'planganmi yoki tekis taqsimlanganmi — Herfindahl–Hirschman indeksi.",
        latex=r"HHI = \sum_{i=1}^{n} s_i^{2},\qquad N_{samarali} = \frac{10\,000}{HHI}",
        symbols={"s_i": "i-qism ulushi (%)", "n": "qismlar soni", "HHI": "0 dan 10 000 gacha"},
        params=[Param("group_by", "Guruhlash", "group", "region", ["region", "type", "section"])],
        min_periods=1,
        run=run_hhi,
    )
)

# ═══════════════════════════════════════════════════════════
# 6. Barqarorlik (variatsiya koeffitsiyenti)
# ═══════════════════════════════════════════════════════════


def run_volatility(panel: pd.DataFrame, p: RunParams) -> Result:
    metric = _metric(p.metric)
    data = monthly(panel, p.start, p.end)
    values = data[metric.key].astype(float)
    active = values[values > 0]
    result = Result(n=len(active))
    if len(active) < 3:
        result.insufficient = True
        result.warnings.append("Barqarorlikni baholash uchun kamida 3 oylik ma'lumot kerak")
        return result

    mean = float(active.mean())
    std = float(active.std(ddof=1))
    cv = std / mean * 100 if mean else None
    z = (values - mean) / std if std else values * 0
    periods = data["period"].tolist()
    outlier_idx = int(np.nanargmax(np.abs(z.where(values > 0)))) if std else 0

    level = "barqaror" if (cv or 0) < 10 else "o'rtacha tebranuvchan" if (cv or 0) < 25 else "beqaror"
    u = metric.unit
    act_list = [float(v) for v in active]
    result.headline = {"label": "Variatsiya koeffitsiyenti", "value": clean(cv), "unit": "percent", "text": fmt_percent(cv),
                       "calc": make_calc(
                           "Variatsiya koeffitsiyenti",
                           "μ = Σx ÷ n; σ = √(Σ(x − μ)² ÷ (n − 1)); CV = σ ÷ μ × 100",
                           [q_unit(fmt_period(per), float(v), u) for per, v in zip(periods, values) if v > 0],
                           [f"n = {len(act_list)} oy (qiymati bor oylar)",
                            f"μ = {num_text(sum(act_list), u)} ÷ {len(act_list)} = {num_text(mean, u)}",
                            f"Σ(x − μ)² = {fmt_number(sum((x - mean) ** 2 for x in act_list))}",
                            f"σ = √({fmt_number(sum((x - mean) ** 2 for x in act_list))} ÷ {len(act_list) - 1}) = {num_text(std, u)}",
                            f"CV = {num_text(std, u)} ÷ {num_text(mean, u)} × 100 = {fmt_percent(cv)}"],
                           fmt_percent(cv),
                           "10% gacha — barqaror, 10–25% — o'rtacha tebranuvchan, 25% dan ortiq — beqaror.",
                       ) if cv is not None else None}
    result.stats = [
        {"label": "O'rtacha oylik", "value": clean(mean), "unit": metric.unit, "text": fmt_value(mean, metric.unit)},
        {"label": "Standart og'ish (σ)", "value": clean(std), "unit": metric.unit, "text": fmt_value(std, metric.unit)},
        {"label": "Baho", "value": level, "unit": "text", "text": level},
    ]
    result.chart = {
        **_series_chart(periods, [(metric.label, values.tolist(), metric.unit)], "bar"),
        "bands": {"mean": clean(mean), "lower": clean(mean - std), "upper": clean(mean + std)},
    }
    result.table = {
        "columns": [
            {"key": "period", "label": "Oy", "unit": "period"},
            {"key": "value", "label": metric.label, "unit": metric.unit},
            {"key": "z", "label": "Og'ish (z)", "unit": "number"},
        ],
        "rows": [{"period": per, "value": clean(v), "z": clean(float(zz)) if v > 0 else None} for per, v, zz in zip(periods, values, z)],
    }
    result.interpretation.append(
        f"{metric.label} oyiga o'rtacha {fmt_value(mean, metric.unit)}, odatdagi tebranish ±{fmt_value(std, metric.unit)} "
        f"(o'rtachaning {fmt_percent(cv)}i) — ko'rsatkich {level}."
    )
    zmax = float(z.iloc[outlier_idx]) if std else 0
    if abs(zmax) >= 1.5:
        result.interpretation.append(
            f"{fmt_period(periods[outlier_idx])} odatdagidan keskin farq qiladi "
            f"({fmt_number(abs(zmax), 1)} σ {'yuqori' if zmax > 0 else 'past'}) — shu oyni alohida ko'rib chiqing."
        )
    return result


register(
    Formula(
        id="volatility",
        title="Barqarorlik (tebranish)",
        category="Tavsifiy",
        description="Ko'rsatkich oydan-oyga qanchalik tebranadi va qaysi oy odatdan tashqari bo'lgan.",
        latex=r"CV = \frac{\sigma}{\mu} \times 100\%,\qquad z_t = \frac{X_t - \mu}{\sigma}",
        symbols={"μ": "o'rtacha", "σ": "standart og'ish", "CV": "variatsiya koeffitsiyenti", "z_t": "t oyning og'ishi"},
        params=[Param("metric", "Ko'rsatkich", "metric", "expense_total", METRIC_KEYS)],
        min_periods=3,
        run=run_volatility,
    )
)

# ═══════════════════════════════════════════════════════════
# 7. Korrelyatsiya (hudud × oy kuzatuvlari)
# ═══════════════════════════════════════════════════════════

MIN_CORRELATION_N = 8


def run_correlation(panel: pd.DataFrame, p: RunParams) -> Result:
    x_metric = _metric(p.metric)
    y_metric = _metric(p.metric2)
    result = Result()
    if x_metric.key == y_metric.key:
        raise ValueError("Ikki xil ko'rsatkich tanlang")

    obs = panel[(panel["region_code"] != NO_REGION)][["period", "region_name", x_metric.key, y_metric.key]]
    obs = obs[(obs[x_metric.key] > 0) & (obs[y_metric.key] > 0)]
    result.n = len(obs)
    if len(obs) < MIN_CORRELATION_N:
        result.insufficient = True
        result.warnings.append(
            f"Bog'liqlikni ishonchli baholash uchun kamida {MIN_CORRELATION_N} ta kuzatuv (hudud × oy) kerak, hozir {len(obs)} ta"
        )
        return result

    x = obs[x_metric.key].astype(float).to_numpy()
    y = obs[y_metric.key].astype(float).to_numpy()
    r, p_value = sps.pearsonr(x, y)
    rho, _ = sps.spearmanr(x, y)
    slope, intercept = np.polyfit(x, y, 1)

    strength = "kuchli" if abs(r) >= 0.7 else "o'rtacha" if abs(r) >= 0.3 else "kuchsiz"
    direction = "to'g'ri (biri oshsa, ikkinchisi ham oshadi)" if r > 0 else "teskari (biri oshsa, ikkinchisi kamayadi)"
    significant = p_value < 0.05

    mx, my = float(x.mean()), float(y.mean())
    sxy = float(((x - mx) * (y - my)).sum())
    sxx = float(((x - mx) ** 2).sum())
    syy = float(((y - my) ** 2).sum())
    result.headline = {"label": "Korrelyatsiya (r)", "value": clean(float(r)), "unit": "number", "text": fmt_number(float(r), 3),
                       "calc": make_calc(
                           "Pirson korrelyatsiyasi (r)",
                           "r = Σ(x − x̄)(y − ȳ) ÷ √(Σ(x − x̄)² × Σ(y − ȳ)²)",
                           [q_unit(f"x̄ — {x_metric.label} o'rtachasi", mx, x_metric.unit), q_unit(f"ȳ — {y_metric.label} o'rtachasi", my, y_metric.unit), q("Kuzatuvlar (hudud × oy)", len(obs), "count")],
                           [f"Σ(x − x̄)(y − ȳ) = {fmt_number(sxy, 2)}",
                            f"Σ(x − x̄)² = {fmt_number(sxx, 2)}",
                            f"Σ(y − ȳ)² = {fmt_number(syy, 2)}",
                            f"r = {fmt_number(sxy, 2)} ÷ √({fmt_number(sxx, 2)} × {fmt_number(syy, 2)}) = {fmt_number(float(r), 4)}",
                            f"R² = r² = {fmt_number(float(r) ** 2, 4)}; p = {fmt_number(float(p_value), 4)} ({'< 0,05 — ahamiyatli' if significant else '≥ 0,05 — ahamiyatsiz'})"],
                           fmt_number(float(r), 3),
                           "|r| ≥ 0,7 — kuchli, 0,3–0,7 — o'rtacha, 0,3 dan kam — kuchsiz bog'liqlik.",
                       )}
    result.stats = [
        {"label": "R² (tushuntirilgan ulush)", "value": clean(float(r**2) * 100), "unit": "percent", "text": fmt_percent(float(r**2) * 100)},
        {"label": "p-qiymat", "value": clean(float(p_value)), "unit": "number", "text": fmt_number(float(p_value), 4)},
        {"label": "Spearman ρ", "value": clean(float(rho)), "unit": "number", "text": fmt_number(float(rho), 3)},
        {"label": "Kuzatuvlar", "value": len(obs), "unit": "count", "text": str(len(obs))},
    ]
    result.chart = {
        "type": "scatter",
        "xLabel": x_metric.label,
        "yLabel": y_metric.label,
        "points": [{"x": clean(float(a)), "y": clean(float(b)), "label": f"{reg} · {fmt_period(per)}"} for a, b, reg, per in zip(x, y, obs["region_name"], obs["period"])],
        "line": {"slope": clean(float(slope)), "intercept": clean(float(intercept))},
        "xUnit": x_metric.unit,
        "yUnit": y_metric.unit,
    }
    result.interpretation.append(
        f"«{x_metric.label}» va «{y_metric.label}» o'rtasida {strength}, {direction} bog'liqlik bor (r = {fmt_number(float(r), 2)})."
    )
    result.interpretation.append(
        f"«{y_metric.label}»dagi farqlarning taxminan {fmt_percent(float(r**2) * 100, 0)}i «{x_metric.label}» bilan izohlanadi."
    )
    result.interpretation.append(
        "Natija statistik ahamiyatli (p < 0,05) — tasodif ehtimoli past."
        if significant
        else "Natija statistik ahamiyatli emas (p ≥ 0,05) — bog'liqlik tasodifiy bo'lishi mumkin."
    )
    result.warnings.append("Bog'liqlik sabab-oqibatni isbotlamaydi: ikkala ko'rsatkichga uchinchi omil ta'sir qilayotgan bo'lishi mumkin.")
    return result


register(
    Formula(
        id="correlation",
        title="Bog'liqlik (korrelyatsiya)",
        category="Bog'liqlik",
        description="Ikki ko'rsatkich birga o'zgaradimi — hududlar × oylar kuzatuvlari bo'yicha Pirson korrelyatsiyasi.",
        latex=r"r = \frac{\sum_i (x_i-\bar{x})(y_i-\bar{y})}{\sqrt{\sum_i (x_i-\bar{x})^2 \sum_i (y_i-\bar{y})^2}}",
        symbols={"x_i, y_i": "i-kuzatuv (hudud × oy)", "x̄, ȳ": "o'rtachalar", "r": "−1 dan +1 gacha"},
        params=[
            Param("metric", "1-ko'rsatkich (X)", "metric", "headcount", METRIC_KEYS),
            Param("metric2", "2-ko'rsatkich (Y)", "metric", "expense_total", METRIC_KEYS),
        ],
        min_periods=2,
        run=run_correlation,
    )
)