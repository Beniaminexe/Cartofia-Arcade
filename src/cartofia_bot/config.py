# src/cartofia_bot/config.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv

load_dotenv()


@dataclass
class BotConfig:
    token: str
    guild_ids: List[int]
    log_level: str


def _parse_guild_ids(raw: str | None) -> List[int]:
    if not raw:
        return []
    ids: List[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            raise ValueError(f"Invalid guild ID in DISCORD_GUILD_IDS: {part!r}")
    return ids


def load_config() -> BotConfig:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("DISCORD_TOKEN is not set in the environment")

    raw_guilds = os.getenv("DISCORD_GUILD_IDS", "").strip()
    guild_ids = _parse_guild_ids(raw_guilds)

    log_level = os.getenv("LOG_LEVEL", "INFO").upper()

    return BotConfig(
        token=token,
        guild_ids=guild_ids,
        log_level=log_level,
    )
