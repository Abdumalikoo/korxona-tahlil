"""Sozlamalar — apps/analytics/.env faylidan o'qiladi."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    #: Prisma bilan bir xil baza manzili (postgresql://user:pass@host:5432/db?schema=public)
    database_url: str
    #: NestJS bilan umumiy maxfiy kalit — boshqa hech kim murojaat qila olmasligi uchun
    analytics_key: str
    #: Xizmat porti (faqat 127.0.0.1 da tinglaydi)
    port: int = 8001

    @property
    def psycopg_url(self) -> str:
        """Prisma'ga xos ?schema=... kabi parametrlarni olib tashlaydi."""
        parts = urlsplit(self.database_url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))



@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
