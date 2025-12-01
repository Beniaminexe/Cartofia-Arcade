# src/cartofia_bot/commands/basic.py
from __future__ import annotations

import logging
from typing import Iterable

import discord
from discord import app_commands

from cartofia_bot.config import BotConfig

log = logging.getLogger(__name__)


def register(tree: app_commands.CommandTree, config: BotConfig) -> None:
    """
    Register basic commands on the given CommandTree.
    """

    @tree.command(name="ping", description="Check if the bot is alive.")
    async def ping(interaction: discord.Interaction) -> None:
        await interaction.response.send_message("Pong 🏓", ephemeral=True)

    @tree.command(name="cartofia_status", description="Show the current Cartofia container status.")
    async def cartofia_status(interaction: discord.Interaction) -> None:
        # Step 1: stub implementation.
        # Step 2 (later): actually query Proxmox for CT2000 status.
        await interaction.response.send_message(
            "Cartofia status: **unknown** (Proxmox integration not wired yet).",
            ephemeral=True,
        )

    _log_registered_commands(tree, ["ping", "cartofia_status"])


def _log_registered_commands(tree: app_commands.CommandTree, names: Iterable[str]) -> None:
    # purely for debug logging; helpful later when the bot grows
    log.info(
        "Registered commands on tree %s: %s",
        tree,
        ", ".join(names),
    )
