#!/usr/bin/env bash
set -euo pipefail

echo "[+] Initialising Cartofia bot structure..."

# Base src structure
mkdir -p src/cartofia_bot/commands

# Python package files
touch src/cartofia_bot/__init__.py
touch src/cartofia_bot/main.py
touch src/cartofia_bot/config.py
touch src/cartofia_bot/logging_utils.py
touch src/cartofia_bot/commands/__init__.py
touch src/cartofia_bot/commands/basic.py

# requirements.txt (only create if it doesn't exist)
if [ ! -f requirements.txt ]; then
  cat > requirements.txt << 'EOF'
discord.py>=2.4.0,<3
python-dotenv>=1.0
EOF
  echo "[+] Created requirements.txt"
else
  echo "[i] requirements.txt already exists, leaving it untouched."
fi

# .env.example (only create if it doesn't exist)
if [ ! -f .env.example ]; then
  cat > .env.example << 'EOF'
# Discord bot token (from the Discord Developer Portal)
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE

# Comma-separated list of guild IDs to sync slash commands to
DISCORD_GUILD_IDS=123456789012345678

# Optional log level: DEBUG, INFO, WARNING, ERROR
LOG_LEVEL=INFO
EOF
  echo "[+] Created .env.example"
else
  echo "[i] .env.example already exists, leaving it untouched."
fi

echo "[+] Done. Now fill in the Python files with the bot code."
echo "    Files created under src/cartofia_bot/ and src/cartofia_bot/commands/"
