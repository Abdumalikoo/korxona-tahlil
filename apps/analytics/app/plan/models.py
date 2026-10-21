"""Hudud uchun reja — prognoz modellari (1 oy oldinga).

Har bir model faqat unga berilgan o'quv qatoridan (train) foydalanadi — kelajak qiymatlari unga
umuman berilmaydi, shuning uchun tarixiy testda ma'lumot sizib kirishi mumkin emas.

Parametrlar (alpha, beta, gamma) o'quv qatoridagi bir qadam oldinga xatolar kvadratlari yig'indisi (SSE)
eng kichik bo'ladigan qilib belgilangan to'rdan tanlanadi. Tasodifiylik ishlatilmaydi — bir xil kirish
har doim bir xil natija beradi.

Qator: numpy massivi (float); bo'sh oy — NaN (nol emas!). Silliqlash modellari oxirgi uzluksiz
bo'lakda (oxirgi NaN dan keyin) o'qitiladi.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

SEASON = 12

#: Murakkablik tartibi — teng natijada soddarog'i tanlanadi
COMPLEXITY = ["naive", "snaive", "ma3", "ses", "croston", "sba", "holt", "hw"]

LABELS = {
    "naive": "Naive (o'tgan oy)",
    "ma3": "3 oylik o'rtacha",
    "snaive": "Mavsumiy naive (o'tgan yilning shu oyi)",
    "ses": "Eksponensial tekislash (SES)",
    "holt": "Holt trend modeli",
    "hw": "Mavsumiy ETS (Holt-Winters, additiv)",
    "croston": "Croston (uzlukli talab)",
    "sba": "SBA (uzlukli talab, tuzatilgan)",
}

ALPHAS = np.array([0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
HOLT_ALPHA = np.array([0.1, 0.2, 0.3, 0.5, 0.7, 0.9])
HOLT_BETA = np.array([0.02, 0.05, 0.1, 0.2, 0.3])
HW_ALPHA = np.array([0.05, 0.1, 0.2, 0.4, 0.6])
HW_BETA = np.array([0.0, 0.02, 0.1])
HW_GAMMA = np.array([0.05, 0.15, 0.3, 0.5])
CROSTON_ALPHA = np.array([0.05, 0.1, 0.2, 0.3])

#: Uzlukli talab: nol oylar ulushi shundan katta bo'lsa
INTERMITTENT_ZERO_SHARE = 0.3


@dataclass
class Fit:
    """Model natijasi: keyingi oy prognozi va tanlangan parametrlar."""

    forecast: float
    params: dict[str, float] = field(default_factory=dict)


# ───────────────────────── Yordamchilar ─────────────────────────


def tail_segment(y: np.ndarray) -> np.ndarray:
    """Oxirgi uzluksiz (NaN siz) bo'lak."""
    if y.size == 0:
        return y
    nan = np.where(np.isnan(y))[0]
    return y[nan[-1] + 1 :] if nan.size else y


def is_intermittent(y: np.ndarray) -> bool:
    obs = y[~np.isnan(y)]
    if obs.size < 6:
        return False
    zeros = float(np.mean(obs == 0))
    return bool(zeros >= INTERMITTENT_ZERO_SHARE and np.count_nonzero(obs) >= 2)


# ───────────────────────── Oddiy modellar ─────────────────────────


def naive(y: np.ndarray) -> Fit | None:
    """Q̂[t+1] = Q[t]"""
    if y.size == 0 or np.isnan(y[-1]):
        return None
    return Fit(float(y[-1]))


def ma3(y: np.ndarray) -> Fit | None:
    """Q̂[t+1] = (Q[t] + Q[t-1] + Q[t-2]) / 3 — uchta to'liq oy bo'lmasa qo'llanmaydi"""
    if y.size < 3 or np.isnan(y[-3:]).any():
        return None
    return Fit(float(np.mean(y[-3:])))


def snaive(y: np.ndarray) -> Fit | None:
    """Q̂[t+1] = Q[t-11] — o'tgan yilning shu oyi"""
    if y.size < SEASON or np.isnan(y[-SEASON]):
        return None
    return Fit(float(y[-SEASON]))


# ───────────────────────── Eksponensial tekislash ─────────────────────────


def ses_path(y: np.ndarray, alphas: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """SES har bir alpha uchun: (SSE, keyingi oy prognozi). Boshlang'ich daraja — birinchi kuzatuv."""
    level = np.full(alphas.shape, y[0], dtype=float)
    sse = np.zeros(alphas.shape)
    for t in range(1, y.size):
        err = y[t] - level
        sse += err * err
        level = level + alphas * err
    return sse, level


def ses(y: np.ndarray, alpha: float | None = None) -> Fit | None:
    """Q̂[t+1] = α·Q[t] + (1−α)·Q̂[t]; α — o'quv qatoridagi SSE bo'yicha"""
    seg = tail_segment(y)
    if seg.size < 4:
        return None
    alphas = ALPHAS if alpha is None else np.array([alpha])
    sse, level = ses_path(seg, alphas)
    i = int(np.argmin(sse))
    return Fit(float(level[i]), {"alpha": float(alphas[i])})


def holt(y: np.ndarray, alpha: float | None = None, beta: float | None = None) -> Fit | None:
    """Holt chiziqli trend: l = α·y + (1−α)(l+b); b = β(l−l₋₁) + (1−β)b; ŷ = l + b"""
    seg = tail_segment(y)
    if seg.size < 6:
        return None
    a_grid = HOLT_ALPHA if alpha is None else np.array([alpha])
    b_grid = HOLT_BETA if beta is None else np.array([beta])
    a, b = np.meshgrid(a_grid, b_grid, indexing="ij")
    a, b = a.ravel(), b.ravel()
    level = np.full(a.shape, seg[0])
    trend = np.full(a.shape, seg[1] - seg[0])
    sse = np.zeros(a.shape)
    for t in range(1, seg.size):
        f = level + trend
        err = seg[t] - f
        if t >= 2:  # 1-qadam trendni boshlash uchun ishlatiladi
            sse += err * err
        new_level = a * seg[t] + (1 - a) * f
        trend = b * (new_level - level) + (1 - b) * trend
        level = new_level
    i = int(np.argmin(sse))
    return Fit(float(level[i] + trend[i]), {"alpha": float(a[i]), "beta": float(b[i])})


def hw(y: np.ndarray, alpha: float | None = None, beta: float | None = None, gamma: float | None = None) -> Fit | None:
    """Additiv Holt-Winters (trend + 12 oylik mavsum). Kamida 24 ta uzluksiz oy kerak."""
    seg = tail_segment(y)
    m = SEASON
    if seg.size < 2 * m:
        return None
    ag = HW_ALPHA if alpha is None else np.array([alpha])
    bg = HW_BETA if beta is None else np.array([beta])
    gg = HW_GAMMA if gamma is None else np.array([gamma])
    a, b, g = np.meshgrid(ag, bg, gg, indexing="ij")
    a, b, g = a.ravel(), b.ravel(), g.ravel()
    k = a.size
    first, second = seg[:m], seg[m : 2 * m]
    level = np.full(k, first.mean())
    trend = np.full(k, (second.mean() - first.mean()) / m)
    season = np.tile(first - first.mean(), (k, 1))  # (k, m)
    sse = np.zeros(k)
    for t in range(m, seg.size):
        s_old = season[:, t % m]
        f = level + trend + s_old
        err = seg[t] - f
        sse += err * err
        new_level = a * (seg[t] - s_old) + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        season[:, t % m] = g * (seg[t] - new_level) + (1 - g) * s_old
        level = new_level
    i = int(np.argmin(sse))
    nxt = seg.size % m
    return Fit(float(level[i] + trend[i] + season[i, nxt]), {"alpha": float(a[i]), "beta": float(b[i]), "gamma": float(g[i])})


# ───────────────────────── Uzlukli talab ─────────────────────────


def _croston(seg: np.ndarray, alphas: np.ndarray, sba: bool) -> tuple[np.ndarray, np.ndarray]:
    """Croston: talab hajmi z va oraliq p alohida tekislanadi; prognoz z/p (SBA: ×(1−α/2))."""
    nz = np.nonzero(seg)[0]
    z = np.full(alphas.shape, seg[nz[0]])
    p = np.full(alphas.shape, float(nz[0] + 1))
    q = 1.0
    sse = np.zeros(alphas.shape)
    for t in range(nz[0] + 1, seg.size):
        fc = z / p * ((1 - alphas / 2) if sba else 1.0)
        err = seg[t] - fc
        sse += err * err
        if seg[t] > 0:
            z = z + alphas * (seg[t] - z)
            p = p + alphas * (q - p)
            q = 1.0
        else:
            q += 1.0
    fc = z / p * ((1 - alphas / 2) if sba else 1.0)
    return sse, fc


def croston(y: np.ndarray, alpha: float | None = None, sba: bool = False) -> Fit | None:
    seg = tail_segment(y)
    if seg.size < 6 or np.count_nonzero(seg) < 2 or not is_intermittent(seg):
        return None
    alphas = CROSTON_ALPHA if alpha is None else np.array([alpha])
    sse, fc = _croston(seg, alphas, sba)
    i = int(np.argmin(sse))
    return Fit(float(fc[i]), {"alpha": float(alphas[i])})


def sba(y: np.ndarray, alpha: float | None = None) -> Fit | None:
    return croston(y, alpha, sba=True)


MODELS: dict[str, Callable[[np.ndarray], Fit | None]] = {
    "naive": naive,
    "ma3": ma3,
    "snaive": snaive,
    "ses": ses,
    "holt": holt,
    "hw": hw,
    "croston": croston,
    "sba": sba,
}


def candidates(y: np.ndarray) -> list[str]:
    """Shu qatorga qo'llash mumkin bo'lgan modellar.

    Uzlukli talabli qatorga trend va mavsumiy modellar majburan qo'llanmaydi;
    uzluksiz qatorga Croston/SBA qo'llanmaydi.
    """
    inter = is_intermittent(y)
    out = []
    for name in COMPLEXITY:
        if inter and name in ("holt", "hw"):
            continue
        if not inter and name in ("croston", "sba"):
            continue
        if MODELS[name](y) is not None:
            out.append(name)
    return out


def forecast(name: str, y: np.ndarray) -> Fit | None:
    fit = MODELS[name](y)
    if fit is None or not np.isfinite(fit.forecast):
        return None
    # Xizmatlar soni manfiy bo'lmaydi
    return Fit(max(0.0, fit.forecast), fit.params)