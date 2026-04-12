# Cartofia Arcade Platform

Self-hosted platform that combines:

- Browser games (static frontend under `arcade/`)
- Account/profile/archive pages (OIDC-aware frontend + Flask API)
- Proxmox-backed infrastructure status and Discord bot control

## Current Direction

The project has moved from "single Cartofia web build" into a broader platform:

- Multi-game arcade lineup (single-player and online room multiplayer)
- Unified branded web experience across Home, Arcade, Minecraft, Account, Archive
- Authenticated profile and archive APIs
- WebSocket room relay for real-time multiplayer game sessions
- Discord bot commands for Proxmox CT operations

## Architecture Summary

Runtime layers:

- Static web layer:
  - `index.html`
  - `arcade/`, `minecraft/`, `account/`, `archive/`
  - Shared UI assets in `assets/site.css` and `assets/site.js`
- API layer:
  - `src/cartofia_bot/api_server.py` (Flask + Flask-Sock)
  - Stats endpoints, archive endpoints, profile endpoints, websocket room relay
- Bot/orchestration layer:
  - `src/cartofia_bot/main.py`
  - `src/cartofia_bot/commands/basic.py`
  - `src/cartofia_bot/proxmox_client.py`

Deployment intent (home lab):

- Proxmox hosts LXC containers
- Gateway container exposes public endpoints
- Internal services stay on isolated network
- Discord bot controls game/service container lifecycle

For a fuller technical map, see `Docs/ARCHITECTURE.md`.

## Repository Layout

- `assets/`: shared frontend CSS/JS
- `arcade/`: game pages and game scripts
- `account/`: account and profile pages
- `archive/`: archive frontend
- `minecraft/`: Minecraft destination page
- `src/cartofia_bot/`: Python bot + API backend
- `Docs/`: architecture notes
- `PROJECT_LOG.md`: chronological implementation log

## Local Development

Python setup:

```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
```

Run API locally:

```bash
set PYTHONPATH=src
python -m cartofia_bot.api_server
```

Run Discord bot locally:

```bash
set PYTHONPATH=src
python -m cartofia_bot.main
```

Serve frontend files locally with any static web server.

## Environment

Copy `.env.example` to `.env` and fill required values:

- `DISCORD_TOKEN`
- `DISCORD_GUILD_IDS`
- Proxmox vars (`PROXMOX_*`)
- API vars (`API_*`, `ARCHIVE_*`, OIDC vars as needed)

## Operational Notes

- The API defaults to same-origin requests when `API_ALLOWED_ORIGINS` is unset.
- `API_SECRET_KEY` must be set in production.
- `PROXMOX_TOKEN_ID` + `PROXMOX_TOKEN_SECRET` are preferred over legacy token mode.

## Status

Feature velocity is high and core functionality is live, but the next quality phase should focus on:

- Breaking down backend/frontend monolith files
- Test coverage
- CI and release pipeline
- Security hardening (token/session strategy)
- Artifact management for large generated game bundles
