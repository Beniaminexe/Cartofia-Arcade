# src/cartofia_bot/commands/basic.py
from __future__ import annotations

import logging
from typing import List

import discord
from discord import app_commands

from cartofia_bot.config import BotConfig

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
        description="Show the current Cartofia container status (stub).",
    )
    async def cartofia_status(interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "Cartofia status: **unknown** (Proxmox integration not wired yet).",
            ephemeral=True,
        )

    # Attach commands to each configured guild
    for guild in guilds:
        log.info("Registering commands for guild %s", guild.id)
        tree.add_command(ct_ping, guild=guild)
        tree.add_command(cartofia_status, guild=guild)

    log.info(
        "Registered commands: %s",
        ", ".join(cmd.name for cmd in tree.get_commands())
    )
