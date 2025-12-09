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


def _format_uptime(seconds: int | float | None) -> str | None:
    if seconds is None:
        return None
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        return None

    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)

    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    if secs or not parts:
        parts.append(f"{secs}s")
    return " ".join(parts)


def register(tree: app_commands.CommandTree, config: BotConfig) -> None:
    """
    Register basic commands on the given CommandTree:

      - /ct_ping
      - /cartofia_info   (new status command with embed)
      - /cartofia_start  (admin only)
      - /cartofia_stop   (admin only)
    """
    if not config.guild_ids:
        log.warning("No guild IDs configured; skipping command registration.")
        return

    prox_client: ProxmoxClient | None = None
    if config.proxmox is not None:
        prox_client = ProxmoxClient(config.proxmox)
        log.info("Proxmox client initialised for host %s", config.proxmox.host)
    else:
        log.warning("Proxmox config not set; Cartofia commands will not work.")

    guilds = _guild_objects(config)

    # ---- ct_ping ----

    @app_commands.command(
        name="ct_ping",
        description="Check if CartoBot is alive on this server.",
    )
    async def ct_ping(interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "ct_ping: CartoBot is alive ✅ (running on Proxmox CT1000).",
            ephemeral=True,
        )

    # ---- cartofia_info (status embed) ----

    @app_commands.command(
        name="cartofia_info",
        description="Show the current Cartofia container status (with embed).",
    )
    async def cartofia_info(interaction: discord.Interaction) -> None:
        if prox_client is None:
            await interaction.response.send_message(
                "Proxmox is not configured yet; ask the admin to set PROXMOX_* env vars.",
                ephemeral=True,
            )
            return

        # quick blocking HTTP in a thread; should be well under 3s
        try:
            data = await asyncio.to_thread(prox_client.get_cartofia_status)
        except Exception as exc:
            log.exception("Failed to fetch Cartofia status from Proxmox")
            await interaction.response.send_message(
                f"Error talking to Proxmox: `{type(exc).__name__}: {exc}`",
                ephemeral=True,
            )
            return

        status = str(data.get("status", "unknown")).lower()
        cpu = data.get("cpu")
        mem = data.get("mem")
        maxmem = data.get("maxmem")
        uptime_seconds = data.get("uptime")

        mem_mb = mem / 1024**2 if isinstance(mem, (int, float)) else None
        maxmem_mb = maxmem / 1024**2 if isinstance(maxmem, (int, float)) else None
        uptime_str = _format_uptime(uptime_seconds)

        if status == "running":
            colour = discord.Colour.green()
        elif status == "stopped":
            colour = discord.Colour.red()
        else:
            colour = discord.Colour.dark_grey()

        embed = discord.Embed(
            title="Cartofia CT2000 Status",
            description=f"Status: **{status.upper()}**",
            colour=colour,
        )

        if isinstance(cpu, (int, float)):
            embed.add_field(name="CPU", value=f"`{cpu:.2%}`", inline=True)

        if mem_mb is not None and maxmem_mb is not None:
            embed.add_field(
                name="RAM",
                value=f"`{mem_mb:.0f} / {maxmem_mb:.0f} MiB`",
                inline=True,
            )

        if uptime_str and status == "running":
            embed.add_field(name="Uptime", value=f"`{uptime_str}`", inline=False)

        if config.proxmox is not None:
            embed.set_footer(
                text=f"Node: {config.proxmox.node} • CTID: {config.proxmox.ct_cartofia_id}"
            )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ---- admin-only start / stop ----

    @app_commands.command(
        name="cartofia_start",
        description="Start the Cartofia container (CT2000) on Proxmox.",
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def cartofia_start(interaction: discord.Interaction) -> None:
        if prox_client is None:
            await interaction.response.send_message(
                "Proxmox is not configured yet; cannot start Cartofia.",
                ephemeral=True,
            )
            return

        try:
            status = await asyncio.to_thread(prox_client.get_cartofia_status)
            if status.get("status") == "running":
                await interaction.response.send_message(
                    "Cartofia is already **running** ✅",
                    ephemeral=True,
                )
                return

            await asyncio.to_thread(prox_client.start_cartofia)
        except Exception as exc:
            log.exception("Failed to start Cartofia")
            await interaction.response.send_message(
                f"Error starting Cartofia: `{type(exc).__name__}: {exc}`",
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            "Start request sent to Proxmox for Cartofia (CT2000). "
            "Give it a few seconds to boot.",
            ephemeral=True,
        )

    @cartofia_start.error
    async def cartofia_start_error(
        interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CheckFailure):
            msg = "You must be a server **administrator** to start Cartofia."
        else:
            log.exception("Unexpected error in cartofia_start", exc_info=error)
            msg = "Unexpected error while handling the command."
        if not interaction.response.is_done():
            await interaction.response.send_message(msg, ephemeral=True)
        else:
            await interaction.followup.send(msg, ephemeral=True)

    @app_commands.command(
        name="cartofia_stop",
        description="Stop the Cartofia container (CT2000) on Proxmox.",
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def cartofia_stop(interaction: discord.Interaction) -> None:
        if prox_client is None:
            await interaction.response.send_message(
                "Proxmox is not configured yet; cannot stop Cartofia.",
                ephemeral=True,
            )
            return

        try:
            status = await asyncio.to_thread(prox_client.get_cartofia_status)
            if status.get("status") == "stopped":
                await interaction.response.send_message(
                    "Cartofia is already **stopped** ✅",
                    ephemeral=True,
                )
                return

            await asyncio.to_thread(prox_client.stop_cartofia)
        except Exception as exc:
            log.exception("Failed to stop Cartofia")
            await interaction.response.send_message(
                f"Error stopping Cartofia: `{type(exc).__name__}: {exc}`",
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            "Stop request sent to Proxmox for Cartofia (CT2000).",
            ephemeral=True,
        )

    @cartofia_stop.error
    async def cartofia_stop_error(
        interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CheckFailure):
            msg = "You must be a server **administrator** to stop Cartofia."
        else:
            log.exception("Unexpected error in cartofia_stop", exc_info=error)
            msg = "Unexpected error while handling the command."
        if not interaction.response.is_done():
            await interaction.response.send_message(msg, ephemeral=True)
        else:
            await interaction.followup.send(msg, ephemeral=True)

    # ---- register commands on each guild ----

    for guild in guilds:
        log.info("Registering commands for guild %s", guild.id)
        tree.add_command(ct_ping, guild=guild)
        tree.add_command(cartofia_info, guild=guild)
        tree.add_command(cartofia_start, guild=guild)
        tree.add_command(cartofia_stop, guild=guild)

    log.info(
        "Registered commands (global only shown here): %s",
        ", ".join(cmd.name for cmd in tree.get_commands()),
    )
