"""Tahlil uchun yagona ma'lumot jadvali: oy × hudud.

Har bir qator — bitta oy va bitta hudud (0 — Markaz, -1 — hududsiz umumkorxona).
Barcha pul ustunlari so'mda (float), tiyindan o'girilgan.

Ustunlar:
  period, region_code, region_name,
  expense_total, expense_doimiy, expense_boshqa,
  expense_payroll, expense_lease, expense_other,
  income_total, payroll_total, headcount
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pandas as pd

from .db import query_df

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

#: Hududsiz (umumkorxona) yozuvlar uchun shartli kod
NO_REGION = -1

MONEY_COLUMNS = [
    "expense_total",
    "expense_doimiy",
    "expense_boshqa",
    "expense_payroll",
    "expense_lease",

    "expense_other",
    "income_total",
    "payroll_total",
]


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    unit: str  # "som" | "kishi"
    #: O'sish yaxshimi (daromad — ha, xarajat — yo'q)
    higher_is_better: bool


METRICS: dict[str, Metric] = {
    m.key: m
    for m in [
        Metric("expense_total", "Jami xarajat", "som", False),
        Metric("expense_doimiy", "Doimiy xarajat", "som", False),
        Metric("expense_boshqa", "Boshqa xarajat", "som", False),
        Metric("expense_payroll", "Ish haqi xarajati", "som", False),
        Metric("expense_lease", "Ijara xarajati", "som", False),
        Metric("expense_other", "Qolgan xarajatlar", "som", False),
        Metric("income_total", "Jami daromad", "som", True),
        Metric("payroll_total", "Ish haqi fondi (hisoblangan)", "som", False),
        Metric("headcount", "Xodimlar soni", "kishi", True),
    ]
}


def validate_period(value: str, label: str) -> str:

    if not PERIOD_RE.match(value or ""):
        raise ValueError(f"{label} noto'g'ri (YYYY-MM)")
    return value


def period_range(start: str, end: str) -> list[str]:
    """Oylar ro'yxati (ikkala chet ham kiradi)."""
    y, m = map(int, start.split("-"))
    result: list[str] = []
    while f"{y}-{m:02d}" <= end and len(result) < 240:
        result.append(f"{y}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return result


def _expenses(start: str, end: str) -> pd.DataFrame:
    return query_df(
        """
        SELECT period,
               COALESCE("regionCode", %(none)s) AS region_code,
               SUM("amountTiyin") AS total,
               SUM("amountTiyin") FILTER (WHERE section = 'DOIMIY') AS doimiy,
               SUM("amountTiyin") FILTER (WHERE section = 'BOSHQA') AS boshqa,
               SUM("amountTiyin") FILTER (WHERE source = 'PAYROLL') AS payroll,
               SUM("amountTiyin") FILTER (WHERE source = 'LEASE') AS lease
        FROM expenses
        WHERE "deletedAt" IS NULL AND period BETWEEN %(start)s AND %(end)s
        GROUP BY 1, 2
        """,
        {"start": start, "end": end, "none": NO_REGION},

    )


def _incomes(start: str, end: str) -> pd.DataFrame:
    return query_df(
        """
        SELECT period,
               COALESCE("regionCode", %(none)s) AS region_code,
               SUM("amountTiyin") AS total
        FROM incomes
        WHERE "deletedAt" IS NULL AND period BETWEEN %(start)s AND %(end)s
        GROUP BY 1, 2
        """,
        {"start": start, "end": end, "none": NO_REGION},
    )


def _payroll(start: str, end: str) -> pd.DataFrame:
    """Tasdiqlangan ish haqi yuklamalari: fond va xodimlar soni (hudud — xodim kartasidan)."""
    return query_df(
        """
        SELECT pe.period,
               e."regionCode" AS region_code,
               SUM(pe."totalTiyin") AS total,
               COUNT(DISTINCT pe."employeePinfl") AS headcount
        FROM payroll_entries pe
        JOIN payroll_batches pb ON pb.id = pe."batchId" AND pb.status = 'COMMITTED'
        JOIN employees e ON e.pinfl = pe."employeePinfl"
        WHERE pe."deletedAt" IS NULL AND pe.period BETWEEN %(start)s AND %(end)s
        GROUP BY 1, 2
        """,
        {"start": start, "end": end},

    )


def _regions() -> dict[int, str]:
    rows = query_df("SELECT code, name FROM regions")
    names = {int(r.code): str(r.name) for r in rows.itertuples()} if not rows.empty else {}
    names.setdefault(0, "Markaz")
    names[NO_REGION] = "Umumkorxona"
    return names


def assemble(
    expenses: pd.DataFrame,
    incomes: pd.DataFrame,
    payroll: pd.DataFrame,
    regions: dict[int, str],
) -> pd.DataFrame:
    """Uch manbani oy × hudud jadvaliga birlashtiradi (sof funksiya — test qilinadi)."""
    key = ["period", "region_code"]
    frames: list[pd.DataFrame] = []

    if not expenses.empty:
        e = expenses.rename(
            columns={
                "total": "expense_total",
                "doimiy": "expense_doimiy",
                "boshqa": "expense_boshqa",
                "payroll": "expense_payroll",
                "lease": "expense_lease",
            }
        )
        frames.append(e)

    if not incomes.empty:
        frames.append(incomes.rename(columns={"total": "income_total"}))
    if not payroll.empty:
        frames.append(payroll.rename(columns={"total": "payroll_total"}))

    if not frames:
        return pd.DataFrame(columns=[*key, "region_name", *MONEY_COLUMNS, "headcount"])

    df = frames[0]
    for other in frames[1:]:
        df = df.merge(other, on=key, how="outer")

    for column in [*MONEY_COLUMNS, "headcount"]:
        if column not in df.columns:
            df[column] = 0
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0)

    # Tiyin → so'm
    for column in MONEY_COLUMNS:
        df[column] = df[column].astype(float) / 100.0

    df["expense_other"] = (df["expense_total"] - df["expense_payroll"] - df["expense_lease"]).clip(lower=0)
    df["headcount"] = df["headcount"].astype(int)
    df["region_code"] = df["region_code"].astype(int)
    df["region_name"] = df["region_code"].map(
        lambda c: "Umumkorxona" if int(c) == NO_REGION else regions.get(int(c), f"Hudud {c}")
    )

    return df.sort_values(key).reset_index(drop=True)[
        [*key, "region_name", *MONEY_COLUMNS, "headcount"]
    ]



def load_panel(start: str, end: str) -> pd.DataFrame:
    """Bazadan oy × hudud jadvalini yig'adi."""
    validate_period(start, "Boshlanish oyi")
    validate_period(end, "Tugash oyi")
    if start > end:
        raise ValueError("Boshlanish oyi tugash oyidan keyin")
    return assemble(_expenses(start, end), _incomes(start, end), _payroll(start, end), _regions())


def monthly(panel: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    """Korxona bo'yicha oylik jami — oraliqdagi har bir oy bilan (bo'sh oylar 0)."""
    columns = [*MONEY_COLUMNS, "headcount"]
    months = pd.DataFrame({"period": period_range(start, end)})
    if panel.empty:
        for column in columns:
            months[column] = 0.0
        return months
    totals = panel.groupby("period", as_index=False)[columns].sum()
    result = months.merge(totals, on="period", how="left").fillna(0)
    result["headcount"] = result["headcount"].astype(int)
    return result
