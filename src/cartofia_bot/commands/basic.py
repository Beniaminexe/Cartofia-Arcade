# src/cartofia_bot/commands/basic.py

import asyncio
import logging
from typing import List

import discord
from discord import app_commands

from cartofia_bot.config import BotConfig
from cartofia_bot.proxmox_client import ProxmoxClient

log = logging.getLogger(__name__)


def _guild_objects(config: BotConfig) -> List[discord.Object]:
    return [discord.Object(id=g_id) for g_id in config.guild_ids]


def register(tree: app_commands.CommandTree, config: BotConfig) -> None:
    """
    Register basic commands (ct_ping, cartofia_status) on the given CommandTree.
    Commands are explicitly attached to the configured guilds.
    """
    if not config.guild_ids:
        log.warning("No guild IDs configured; skipping command registration.")
        return

    prox_client: ProxmoxClient | None = None
    if config.proxmox is not None:
        prox_client = ProxmoxClient(config.proxmox)
    else:
        log.warning("Proxmox config not set; /cartofia_status will not work.")

    guilds = _guild_objects(config)

    @app_commands.command(
        name="ct_ping",
        description="Check if CartoBot is alive on this server.",
    )
    async def ct_ping(interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "ct_ping: CartoBot is alive ✅ (running on Proxmox CT1000).",
            ephemeral=True,
        )

    @app_commands.command(
        name="cartofia_status",
        description="Show the current Cartofia container status.",
    )
    async def cartofia_status(interaction: discord.Interaction) -> None:
        if prox_client is None:
            await interaction.response.send_message(
                "Proxmox is not configured yet; ask the admin to set PROXMOX_* env vars.",
                ephemeral=True,
            )
            return

        # Show "thinking..." while we talk to Proxmox
        await interaction.response.defer(ephemeral=True, thinking=True)

        try:
            data = await asyncio.to_thread(prox_client.get_cartofia_status)
        except Exception as exc:
            log.exception("Failed to fetch Cartofia status from Proxmox")
            await interaction.followup.send(
                f"Error talking to Proxmox: `{type(exc).__name__}: {exc}`",
                ephemeral=True,
            )
            return

        status = data.get("status", "unknown")
        cpu = data.get("cpu")
        mem = data.get("mem")
        maxmem = data.get("maxmem")

        mem_mb = mem / 1024**2 if isinstance(mem, (int, float)) else None
        maxmem_mb = maxmem / 1024**2 if isinstance(maxmem, (int, float)) else None

        lines = [f"Status: **{status}**"]
        if isinstance(cpu, (int, float)):
            lines.append(f"CPU: `{cpu:.2%}`")
        if mem_mb is not None and maxmem_mb is not None:
            lines.append(f"RAM: `{mem_mb:.0f} / {maxmem_mb:.0f} MiB`")

        await interaction.followup.send("\n".join(lines), ephemeral=True)

    # Attach commands to each guild
    for guild in guilds:
        log.info("Registering commands for guild %s", guild.id)
        tree.add_command(ct_ping, guild=guild)
        tree.add_command(cartofia_status, guild=guild)

    log.info(
        "Registered commands: %s",
        ", ".join(cmd.name for cmd in tree.get_commands())
    )
