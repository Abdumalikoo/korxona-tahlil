"""Formulalar katalogi — umumiy turlar, ro'yxatga olish va formatlash."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

# ═══════════════════════════════════════════════════════════
# Kirish parametrlari va natija
# ═══════════════════════════════════════════════════════════


@dataclass
class RunParams:
    start: str
    end: str
    metric: str = "expense_total"
    metric2: str = "headcount"
    group_by: str = "section"


@dataclass
class Result:
    """Formula natijasi — frontend shu tuzilmani chizadi."""

    #: Asosiy raqam (katta shriftda)
    headline: dict[str, Any] | None = None
    #: Qo'shimcha ko'rsatkichlar: [{label, value, unit, hint}]
    stats: list[dict[str, Any]] = field(default_factory=list)
    #: Grafik: {type: line|bar|pie, x: [...], series: [{name, values, unit}]}
    chart: dict[str, Any] | None = None
    #: Jadval: {columns: [{key, label, unit}], rows: [{...}]}
    table: dict[str, Any] | None = None
    #: Oddiy tildagi xulosalar
    interpretation: list[str] = field(default_factory=list)
    #: Ogohlantirishlar (ma'lumot kam, nolga bo'lish va h.k.)
    warnings: list[str] = field(default_factory=list)
    #: Kuzatuvlar soni
    n: int = 0
    #: Ma'lumot yetarli emas — raqamlar ko'rsatilmaydi
    insufficient: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "headline": self.headline,
            "stats": self.stats,
            "chart": self.chart,
            "table": self.table,
            "interpretation": self.interpretation,
            "warnings": self.warnings,
            "n": self.n,
            "insufficient": self.insufficient,
        }


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    kind: str  # "metric" | "group"
    default: str
    options: list[str] | None = None


@dataclass(frozen=True)
class Formula:
    id: str
    title: str
    category: str  # "Tavsifiy" | "Bog'liqlik" | ...
    description: str
    latex: str
    #: Formuladagi belgilar izohi: {"X_t": "t oydagi qiymat"}
    symbols: dict[str, str]
    params: list[Param]
    #: Kamida nechta oy kerak
    min_periods: int
    run: Callable[[pd.DataFrame, RunParams], Result]

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "category": self.category,
            "description": self.description,
            "latex": self.latex,
            "symbols": self.symbols,
            "minPeriods": self.min_periods,
            "params": [
                {"key": p.key, "label": p.label, "kind": p.kind, "default": p.default, "options": p.options}
                for p in self.params
            ],
        }


REGISTRY: dict[str, Formula] = {}


def register(formula: Formula) -> Formula:
    if formula.id in REGISTRY:
        raise ValueError(f"Formula takrorlandi: {formula.id}")
    REGISTRY[formula.id] = formula
    return formula


# ═══════════════════════════════════════════════════════════
# Formatlash (o'zbekcha)
# ═══════════════════════════════════════════════════════════

MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
          "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]


def fmt_period(period: str) -> str:
    y, m = period.split("-")
    return f"{MONTHS[int(m) - 1].capitalize()} {y}"


def fmt_number(value: float, decimals: int = 0) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    text = f"{abs(value):,.{decimals}f}".replace(",", " ").replace(".", ",")
    return f"-{text}" if value < 0 else text


def fmt_money(value: float) -> str:
    """So'mda: katta summalar mln/mlrd bilan."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    absolute = abs(value)
    if absolute >= 1e9:
        return f"{fmt_number(value / 1e9, 2)} mlrd so'm"
    if absolute >= 1e6:
        return f"{fmt_number(value / 1e6, 1)} mln so'm"
    return f"{fmt_number(value)} so'm"


def fmt_percent(value: float | None, decimals: int = 1, sign: bool = False) -> str:
    if value is None or math.isnan(value) or math.isinf(value):
        return "—"
    prefix = "+" if sign and value > 0 else ""
    return f"{prefix}{fmt_number(value, decimals)}%"


def fmt_value(value: float, unit: str) -> str:
    if unit == "som":
        return fmt_money(value)
    if unit == "percent":
        return fmt_percent(value)
    if unit == "kishi":
        return f"{fmt_number(value)} kishi"
    return fmt_number(value, 2)


def safe_div(a: float, b: float) -> float | None:
    if b == 0 or b is None or (isinstance(b, float) and math.isnan(b)):
        return None
    return a / b


def clean(value: Any) -> Any:
    """JSON uchun: NaN/inf → None, numpy turlari → oddiy."""
    if value is None:
        return None
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else round(value, 6)
    if hasattr(value, "item"):
        return clean(value.item())
    return value


# ═══════════════════════════════════════════════════════════
# «Qanday hisoblandi?» — saytdagi Calc bilan bir xil shakl:
#   {title, formula, inputs: [{label, value, kind, source}], steps: [...], result, note}
#   Pul (kind="money") saytga TIYINDA yuboriladi; matnda to'liq so'mda yoziladi.
# ═══════════════════════════════════════════════════════════


def full_money(value: float) -> str:
    """To'liq summa: 1 234 567 so'm (qisqartirmasdan)."""
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    return f"{fmt_number(round(value))} so'm"


def q(label: str, value: float | None, kind: str = "money", source: str | None = None) -> dict[str, Any]:
    """Hisobdagi bitta son. kind: money (so'm), count, pct, ratio."""
    v = 0.0 if value is None or (isinstance(value, float) and math.isnan(value)) else float(value)
    item: dict[str, Any] = {"label": label, "value": clean(v * 100 if kind == "money" else v), "kind": kind}
    if source:
        item["source"] = source
    return item


def q_unit(label: str, value: float | None, unit: str, source: str | None = None) -> dict[str, Any]:
    """Formula birligidan (som, kishi, percent...) q() turiga."""
    kind = "money" if unit == "som" else "pct" if unit == "percent" else "count" if unit in ("count",) else "ratio"
    return q(label, value, kind, source)


def num_text(value: float | None, unit: str) -> str:
    """Hisob qadamlarida: pul — to'liq so'm, boshqalar — son."""
    if value is None:
        return "—"
    if unit == "som":
        return fmt_number(round(value))
    if unit == "percent":
        return fmt_percent(value, 2)
    if unit == "kishi":
        return fmt_number(value, 1)
    return fmt_number(value, 2)


def make_calc(title: str, formula: str, inputs: list[dict[str, Any]], steps: list[str], result: str, note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"title": title, "formula": formula, "inputs": inputs[:40], "steps": steps, "result": result}
    if len(inputs) > 40:
        out["steps"] = [f"(Sonlar ro'yxatida birinchi 40 tasi ko'rsatilgan, jami {len(inputs)} ta)"] + steps
    if note:
        out["note"] = note
    return out