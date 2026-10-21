"""Hudud uchun reja — FastAPI marshrutlari.

NestJS tarixiy ma'lumotni (hudud × xizmat × oy), tariflar va xodimlar ma'lumotini JSON da yuboradi;
bu xizmat bazaga yozmaydi — faqat hisoblaydi va natijani qaytaradi (bir xil kirish — bir xil natija).
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import math

import numpy as np

from . import models as M
from .engine import compute

PERIOD = r"^\d{4}-(0[1-9]|1[0-2])$"


class ComputeBody(BaseModel):
    targetPeriod: str = Field(pattern=PERIOD)
    months: list[str] = Field(min_length=1, max_length=120)
    series: list[dict[str, Any]] = Field(max_length=5000)
    tariffs: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []
    regions: list[dict[str, Any]] = []
    options: dict[str, Any] = {}
    allocation: dict[str, Any] | None = None


def to_json(value: Any) -> Any:
    """numpy turlari → oddiy Python; NaN/inf → None (JSON da yo'q qiymat)."""
    if isinstance(value, dict):
        return {str(k): to_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def build_router(require_key) -> APIRouter:  # noqa: ANN001 — main.py dagi kalit tekshiruvi
    router = APIRouter(prefix="/plan", dependencies=[Depends(require_key)])

    @router.get("/models")
    def model_list() -> dict:
        return {"models": [{"key": k, "label": M.LABELS[k], "complexity": i} for i, k in enumerate(M.COMPLEXITY)]}

    @router.post("/compute")
    def run(body: ComputeBody) -> dict:
        started = time.perf_counter()
        for m in body.months:
            if len(m) != 7:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Oy formati noto'g'ri (YYYY-MM)")
        n = len(body.months)
        for s in body.series:
            if len(s.get("qty", [])) != n:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Qator uzunligi oylar soniga teng emas")
        try:
            result = compute(body.model_dump())
        except ValueError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
        result["tookMs"] = round((time.perf_counter() - started) * 1000)
        result["engine"] = "apps/analytics · plan v1"
        return to_json(result)

    return router