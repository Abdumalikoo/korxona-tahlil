"""Baza bilan ishlash — faqat o'qish rejimida.

Tahlil xizmati hech qachon ma'lumotni o'zgartirmaydi: har bir ulanish
`read_only` rejimida ochiladi, yozishga urinish PostgreSQL xatosi beradi.
"""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from .config import get_settings


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    with psycopg.connect(settings.psycopg_url, connect_timeout=5, row_factory=dict_row) as conn:
        conn.read_only = True
        yield conn


def query(sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """SQL natijasini lug'atlar ro'yxati sifatida qaytaradi."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)  # type: ignore[arg-type]
        return list(cur.fetchall())


def query_df(sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> pd.DataFrame:
    """SQL natijasini pandas DataFrame sifatida qaytaradi."""
    return pd.DataFrame(query(sql, params))
