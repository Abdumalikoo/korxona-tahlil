"""Korxona tahlil — matematik va ekonometrik hisob-kitob xizmati.

Faqat NestJS API murojaat qiladi (X-Analytics-Key sarlavhasi bilan).
Ishga tushirish:  .venv\\Scripts\\python -m uvicorn app.main:app --port 8001 --reload
"""

import platform
import secrets
import time
from importlib.metadata import PackageNotFoundError, version
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from . import dataset
from .config import get_settings
from .db import query
from .formulas import descriptive  # noqa: F401 — formulalarni ro'yxatga oladi
from .formulas.base import REGISTRY, RunParams, clean

app = FastAPI(
    title="Korxona tahlil — Modellar",
    version="0.2.0",
    docs_url="/docs",
    redoc_url=None,
)

LIBRARIES = ["numpy", "pandas", "scipy", "statsmodels", "linearmodels", "pyreadstat"]

GROUP_LABELS = {"section": "Doimiy / Boshqa", "type": "Xarajat turi", "region": "Hududlar"}

PERIOD_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def require_key(x_analytics_key: Annotated[str | None, Header()] = None) -> None:
    """NestJS bilan umumiy kalitni tekshiradi (vaqt bo'yicha xavfsiz solishtirish)."""
    expected = get_settings().analytics_key
    if not x_analytics_key or not secrets.compare_digest(x_analytics_key, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Kalit noto'g'ri")


def library_versions() -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for name in LIBRARIES:
        try:
            result[name] = version(name)
        except PackageNotFoundError:
            result[name] = None
    return result


# ═══════════════════════════════════════════════════════════
# Holat
# ═══════════════════════════════════════════════════════════


@app.get("/health", dependencies=[Depends(require_key)])
def health() -> dict:
    """Xizmat holati: Python, kutubxonalar va baza bilan aloqa."""
    started = time.perf_counter()
    database: dict = {"ok": False}
    try:
        rows = query(
            """
            SELECT
              (SELECT count(*) FROM expenses  WHERE "deletedAt" IS NULL) AS expenses,
              (SELECT count(*) FROM incomes   WHERE "deletedAt" IS NULL) AS incomes,
              (SELECT min(period) FROM expenses WHERE "deletedAt" IS NULL) AS first_period,
              (SELECT max(period) FROM expenses WHERE "deletedAt" IS NULL) AS last_period
            """
        )
        database = {"ok": True, **rows[0]}
    except Exception as error:  # noqa: BLE001 — holatni ko'rsatish uchun
        database = {"ok": False, "error": str(error).splitlines()[0][:300]}

    return {
        "ok": database["ok"],
        "python": platform.python_version(),
        "libraries": library_versions(),
        "database": database,
        "formulas": len(REGISTRY),
        "tookMs": round((time.perf_counter() - started) * 1000),
    }


# ═══════════════════════════════════════════════════════════
# Formulalar
# ═══════════════════════════════════════════════════════════


class RunBody(BaseModel):
    start: str = Field(pattern=PERIOD_PATTERN)
    end: str = Field(pattern=PERIOD_PATTERN)
    metric: str | None = None
    metric2: str | None = None
    groupBy: str | None = None


@app.get("/formulas", dependencies=[Depends(require_key)])
def formulas() -> dict:
    """Katalog: formulalar, ko'rsatkichlar va guruhlash turlari."""
    return {
        "formulas": [f.describe() for f in REGISTRY.values()],
        "metrics": [
            {"key": m.key, "label": m.label, "unit": m.unit, "higherIsBetter": m.higher_is_better}
            for m in dataset.METRICS.values()
        ],
        "groups": [{"key": k, "label": v} for k, v in GROUP_LABELS.items()],
    }


@app.post("/formulas/{formula_id}/run", dependencies=[Depends(require_key)])
def run_formula(formula_id: str, body: RunBody) -> dict:
    """Formulani tanlangan davr va parametrlar bilan hisoblaydi."""
    formula = REGISTRY.get(formula_id)
    if not formula:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formula topilmadi")
    if body.start > body.end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boshlanish oyi tugash oyidan keyin")

    defaults = {p.key: p.default for p in formula.params}
    params = RunParams(
        start=body.start,
        end=body.end,
        metric=body.metric or defaults.get("metric", "expense_total"),
        metric2=body.metric2 or defaults.get("metric2", "headcount"),
        group_by=body.groupBy or defaults.get("group_by", "section"),
    )

    started = time.perf_counter()
    try:
        months = len(dataset.period_range(params.start, params.end))
        if months < formula.min_periods:
            raise ValueError(f"Bu formula uchun kamida {formula.min_periods} oy tanlang")
        panel_df = dataset.load_panel(params.start, params.end)
        result = formula.run(panel_df, params)
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    return {
        "formula": formula.describe(),
        "params": {
            "start": params.start,
            "end": params.end,
            "metric": params.metric,
            "metric2": params.metric2,
            "groupBy": params.group_by,
        },
        "result": result.to_dict(),
        "tookMs": round((time.perf_counter() - started) * 1000),
    }


@app.get("/panel", dependencies=[Depends(require_key)])
def panel(start: str, end: str) -> dict:
    """Oy × hudud jadvali — tekshirish va eksport uchun."""
    try:
        df = dataset.load_panel(start, end)
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    return {
        "columns": list(df.columns),
        "rows": [{k: clean(v) for k, v in row.items()} for row in df.to_dict(orient="records")],
    }


# Hudud uchun reja — prognoz va xodimlar rejasi (/plan/...)
from .plan.api import build_router as build_plan_router  # noqa: E402

app.include_router(build_plan_router(require_key))
