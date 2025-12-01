# src/cartofia_bot/config.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional

from dotenv import load_dotenv

from cartofia_bot.proxmox_client import ProxmoxConfig

load_dotenv()


@dataclass
class BotConfig:
    token: str
    guild_ids: List[int]
    log_level: str
    proxmox: Optional[ProxmoxConfig] = None


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

    # Proxmox config (optional but recommended)
    prox_host = os.getenv("PROXMOX_HOST")
    prox_token_id = os.getenv("PROXMOX_TOKEN_ID")
    prox_token_secret = os.getenv("PROXMOX_TOKEN_SECRET")
    prox_node = os.getenv("PROXMOX_NODE")
    prox_ct_id = os.getenv("PROXMOX_CT_CARTOFIA_ID")
    prox_port = int(os.getenv("PROXMOX_PORT", "8006"))
    prox_verify_ssl = os.getenv("PROXMOX_VERIFY_SSL", "false").lower() == "true"

    proxmox_cfg = None
    if all([prox_host, prox_token_id, prox_token_secret, prox_node, prox_ct_id]):
        proxmox_cfg = ProxmoxConfig(
            host=prox_host,
            port=prox_port,
            token_id=prox_token_id,
            token_secret=prox_token_secret,
            node=prox_node,
            ct_cartofia_id=int(prox_ct_id),
            verify_ssl=prox_verify_ssl,
        )
    else:
        # We don't hard-fail here; /cartofia_status will complain if used.
        pass

    return BotConfig(
        token=token,
        guild_ids=guild_ids,
        log_level=log_level,
        proxmox=proxmox_cfg,
    )
