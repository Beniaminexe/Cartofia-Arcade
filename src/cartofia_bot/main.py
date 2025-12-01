# src/cartofia_bot/main.py
from __future__ import annotations

import asyncio
import logging

import discord
from discord import app_commands

from cartofia_bot.config import load_config
from cartofia_bot.logging_utils import setup_logging
from cartofia_bot import commands as command_pkg


log = logging.getLogger(__name__)

class CartofiaBot(discord.Client):
    def __init__(self, config, **kwargs):
        intents = discord.Intents.default()
        super().__init__(intents=intents, **kwargs)
        self.config = config
        self.tree = app_commands.CommandTree(self)

    async def on_ready(self) -> None:
        log.info("Logged in as %s (id=%s)", self.user, self.user.id)

    async def setup_hook(self) -> None:
        from cartofia_bot.commands import basic  # explicit to avoid confusion

        basic.register(self.tree, self.config)

        if self.config.guild_ids:
            for guild_id in self.config.guild_ids:
                guild = discord.Object(id=guild_id)
                log.info("Syncing commands to guild %s", guild_id)
                await self.tree.sync(guild=guild)
        else:
            log.warning("No DISCORD_GUILD_IDS configured, syncing globally")
            await self.tree.sync()


class CartofiaBot(discord.Client):
    def __init__(self, config, **kwargs):
        # We only need basic intents for slash commands
        intents = discord.Intents.default()
        super().__init__(intents=intents, **kwargs)

        self.config = config
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        """
        Called by discord.py when the bot is starting up.
        Great place to register commands and sync them.
        """
        # Register commands from our commands package
        # Currently only basic commands; we can add more modules later.
        command_pkg.basic.register(self.tree, self.config)

        # Sync application commands to guilds.
        # We prefer GUILD-scoped for faster updates during development.
        if self.config.guild_ids:
            for guild_id in self.config.guild_ids:
                guild = discord.Object(id=guild_id)
                log.info("Syncing commands to guild %s", guild_id)
                await self.tree.sync(guild=guild)
        else:
            log.warning(
                "No DISCORD_GUILD_IDS configured. "
                "Commands will only sync globally (slower propagation)."
            )
            await self.tree.sync()


async def main() -> None:
    config = load_config()
    setup_logging(config.log_level)

    log.info("Starting CartofiaBot...")
    bot = CartofiaBot(config=config)
    await bot.start(config.token)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.warning("Bot interrupted by user, shutting down.")
