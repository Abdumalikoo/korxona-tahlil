"""Hududiy prognozni xodimlar o'rtasida xizmatlar kesimida taqsimlash.

Asosiy qoida: hudud prognozi o'zgarmaydi — xodimlar rejalari va «taqsimlanmagan» qism yig'indisi
har bir xizmat bo'yicha aynan hudud prognoziga teng (so'mgacha, eng katta qoldiq usuli bilan).

Usullar:
  share  — xodimning shu xizmatdagi tarixiy daromad ulushi: Share[i,s] = Rev[i,s] / ΣRev[s]
  perday — ish kunlari bilan normallashtirilgan: (Rev[i,s] / ishlangan kun) × rejalashtirilgan kun
Yangi xodim (tarixi yo'q): shu hududdagi o'xshash xodimlarning bir kunlik natijasi medianasi × rejalashtirilgan kun.
Taqqoslanadigan xodimlar bo'lmasa yoki xizmatni hech kim ko'rsatmagan bo'lsa — summa «taqsimlanmagan».
"""

from __future__ import annotations

import statistics
from typing import Any

from .engine import largest_remainder, period_add


def _avg(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def allocate_region(reg: dict[str, Any], data: dict[str, Any], opts: dict[str, Any], months: list[str], target: str) -> dict[str, Any]:
    method = str(opts.get("method", "share"))
    window = max(1, min(12, int(opts.get("window", 6))))
    allow_new = bool(opts.get("newEmployees", True))
    win = months[-window:]
    win_set = set(win)
    notes: list[str] = []

    target_start = f"{target}-01"
    target_end = f"{period_add(target, 1)}-01"

    people = {e["pinfl"]: e for e in data.get("employees", [])}
    eligible = []
    for p, e in people.items():
        if e.get("firedAt") and str(e["firedAt"])[:10] < target_start:
            continue
        if e.get("hiredAt") and str(e["hiredAt"])[:10] >= target_end:
            continue
        if not e.get("active", True) and not e.get("firedAt"):
            continue
        eligible.append(p)
    eligible_set = set(eligible)

    # Tarixiy daromad xizmatlar kesimida (faqat shu hududda)
    hist: dict[str, dict[str, float]] = {}
    hist_qty: dict[str, float] = {}
    for r in data.get("empServices", []):
        if r["period"] not in win_set:
            continue
        hist.setdefault(r["pinfl"], {})
        hist[r["pinfl"]][r["service"]] = hist[r["pinfl"]].get(r["service"], 0.0) + float(r.get("revenue") or 0)
        hist_qty[r["pinfl"]] = hist_qty.get(r["pinfl"], 0.0) + float(r.get("qty") or 0)
    mode = "service"
    totals: dict[str, float] = {}
    if not hist:
        for r in data.get("empTotals", []):
            if r["period"] in win_set:
                totals[r["pinfl"]] = totals.get(r["pinfl"], 0.0) + float(r.get("revenue") or 0)
        if totals:
            mode = "total"
            notes.append("Xodim × xizmat ma'lumoti yo'q — xodimlarning jami tushumi ulushi har bir xizmatga bir xil qo'llandi")

    # Ishlangan kunlar
    days: dict[str, float] = {}
    day_months: dict[str, int] = {}
    ratio: dict[str, list[float]] = {}
    planned_explicit: dict[str, float] = {}
    work_days = {k: float(v) for k, v in (data.get("workDays") or {}).items() if v}
    for r in data.get("empMonths", []):
        wd = r.get("workedDays")
        if wd is None:
            continue
        if r["period"] == target:
            planned_explicit[r["pinfl"]] = float(wd)
        elif r["period"] in win_set:
            days[r["pinfl"]] = days.get(r["pinfl"], 0.0) + float(wd)
            day_months[r["pinfl"]] = day_months.get(r["pinfl"], 0) + 1
            if work_days.get(r["period"]):
                ratio.setdefault(r["pinfl"], []).append(float(wd) / work_days[r["period"]])

    def planned(p: str) -> tuple[float | None, str]:
        if p in planned_explicit:
            return planned_explicit[p], "jadval"
        if p in ratio and work_days.get(target):
            return round(_avg(ratio[p]) * work_days[target], 1), "taxmin: o'rtacha ulush × oy ish kunlari"  # type: ignore[operator]
        if day_months.get(p):
            return round(days[p] / day_months[p], 1), "taxmin: tarixiy o'rtacha"
        return None, "noma'lum"

    services = [x for x in reg["services"] if x.get("forecastRev")]
    weight: dict[str, dict[str, float]] = {p: {} for p in eligible}
    has_hist = [p for p in eligible if (sum(hist.get(p, {}).values()) if mode == "service" else totals.get(p, 0)) > 0]
    method_used = method
    if method == "perday":
        missing = [p for p in has_hist if not days.get(p)]
        if missing:
            method_used = "share"
            notes.append(f"{len(missing)} ta xodimning ishlangan kunlari yo'q — tarixiy ulush usuli qo'llandi")

    plan_days: dict[str, tuple[float | None, str]] = {p: planned(p) for p in eligible}
    for p in has_hist:
        for x in services:
            s = x["service"]
            base = hist.get(p, {}).get(s, 0.0) if mode == "service" else totals.get(p, 0.0)
            if base <= 0:
                continue
            if method_used == "perday":
                pd_, _src = plan_days[p]
                if pd_ is None:
                    continue
                weight[p][s] = base / days[p] * pd_
            else:
                weight[p][s] = base

    # Yangi xodimlar
    new_people = [p for p in eligible if p not in has_hist]
    manual_needed = []
    for p in new_people:
        if not allow_new:
            manual_needed.append(p)
            continue
        pd_, _src = plan_days[p]
        position = (people[p].get("position") or "").strip().lower()
        peers = [q for q in has_hist if days.get(q)]
        same = [q for q in peers if (people[q].get("position") or "").strip().lower() == position and position]
        group = same if len(same) >= 2 else peers
        if len(group) < 2:
            manual_needed.append(p)
            continue
        if pd_ is None:
            pd_ = statistics.median([days[q] / day_months[q] for q in group if day_months.get(q)])
            plan_days[p] = (round(pd_, 1), "taxmin: o'xshash xodimlar medianasi")
        for x in services:
            s = x["service"]
            per_day = [(hist.get(q, {}).get(s, 0.0) if mode == "service" else totals.get(q, 0.0)) / days[q] for q in group]
            med = statistics.median(per_day)
            if med > 0:
                weight[p][s] = med * pd_
    if manual_needed:
        notes.append(f"{len(manual_needed)} ta yangi xodim uchun taqqoslanadigan ma'lumot yetarli emas — reja qo'lda belgilanadi")

    # Taqsimlash (so'mgacha, yig'indi aynan xizmat prognoziga teng)
    plans: dict[str, dict[str, int]] = {p: {} for p in eligible}
    unallocated = []
    for x in services:
        s = x["service"]
        F = int(x["forecastRev"])
        ps = [p for p in eligible if weight[p].get(s, 0) > 0]
        if not ps:
            unallocated.append({"service": s, "serviceName": x["serviceName"], "amount": F, "reason": "Tarixda bu xizmatni ko'rsatgan faol xodim yo'q"})
            continue
        parts = largest_remainder(F, [weight[p][s] for p in ps])
        for p, v in zip(ps, parts):
            plans[p][s] = v

    region_total = int(reg["forecastRev"])
    emp_out = []
    last_month = months[-1]
    prev_plan = {r["pinfl"]: float(r.get("plan") or 0) for r in data.get("empTotals", []) if r["period"] == last_month and r.get("plan") is not None}
    last_rev: dict[str, float] = {}
    for r in data.get("empServices", []):
        if r["period"] == last_month:
            last_rev[r["pinfl"]] = last_rev.get(r["pinfl"], 0.0) + float(r.get("revenue") or 0)
    if not last_rev:
        for r in data.get("empTotals", []):
            if r["period"] == last_month:
                last_rev[r["pinfl"]] = float(r.get("revenue") or 0)
    for p in eligible:
        e = people[p]
        total = int(sum(plans[p].values()))
        h_rev = sum(hist.get(p, {}).values()) if mode == "service" else totals.get(p, 0.0)
        pdays, psrc = plan_days[p]
        svc = [
            {
                "service": x["service"],
                "serviceName": x["serviceName"],
                "hist": hist.get(p, {}).get(x["service"], 0.0) if mode == "service" else None,
                "share": (weight[p].get(x["service"], 0.0) / sum(weight[q].get(x["service"], 0.0) for q in eligible)) if weight[p].get(x["service"]) else 0.0,
                "plan": plans[p].get(x["service"], 0),
            }
            for x in services
            if plans[p].get(x["service"]) or (mode == "service" and hist.get(p, {}).get(x["service"]))
        ]
        emp_out.append(
            {
                "pinfl": p,
                "name": e.get("name"),
                "position": e.get("position"),
                "isNew": p in new_people,
                "manualNeeded": p in manual_needed,
                "workedDays": days.get(p),
                "workedMonths": day_months.get(p, 0),
                "plannedDays": pdays,
                "plannedDaysSource": psrc,
                "histRev": h_rev,
                "histQty": hist_qty.get(p),
                "lastRev": last_rev.get(p),
                "potential": (h_rev / days[p] * pdays) if days.get(p) and pdays else None,
                "plan": total,
                "share": total / region_total if region_total else None,
                "prevPlan": prev_plan.get(p),
                "services": sorted(svc, key=lambda r: -r["plan"]),
            }
        )
    emp_out.sort(key=lambda r: -r["plan"])
    excluded = [p for p in set(hist) | set(totals) if p not in eligible_set]
    if excluded:
        notes.append(f"{len(excluded)} ta xodim tarixda bor, lekin prognoz oyida faol emas yoki boshqa hududda — rejaga kiritilmadi")

    un_total = int(sum(u["amount"] for u in unallocated))
    emp_total = int(sum(r["plan"] for r in emp_out))
    return {
        "method": method,
        "methodUsed": method_used,
        "mode": mode,
        "window": win,
        "employees": emp_out,
        "unallocated": unallocated,
        "unallocatedTotal": un_total,
        "check": {"regionForecast": region_total, "employeesTotal": emp_total, "unallocated": un_total, "diff": region_total - emp_total - un_total},
        "notes": notes,
    }