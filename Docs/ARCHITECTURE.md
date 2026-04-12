# Cartofia Architecture

## 1. High-Level System

Cartofia is a hybrid platform with three layers:

1. Static Web Layer
2. API + Realtime Layer
3. Bot + Infra Control Layer

The current repo contains source for all three.

## 2. Runtime Components

### Static Web Layer

- Entry and destination pages:
  - `/` (`index.html`)
  - `/arcade/`
  - `/minecraft/`
  - `/account/`
  - `/archive/`
- Shared assets:
  - `assets/site.css`
  - `assets/site.js`
- Game-specific pages and scripts:
  - `arcade/<game>/index.html`
  - `arcade/<game>/game.js` for games split into separate scripts

### API + Realtime Layer

`src/cartofia_bot/api_server.py` currently hosts:

- Stats endpoints (`/api/stats*`)
- Archive endpoints (`/api/archive/*`)
- Profile endpoints (`/api/profile/*`)
- WebSocket room relay (`/ws/bomber-raid`, `/ws/chess`, `/ws/blackjack`)

Storage:

- SQLite (`archive_data/archive.db`) for archive/profile metadata
- File storage under `archive_data/files` and `archive_data/profiles/avatars`

### Bot + Infra Control Layer

`src/cartofia_bot/main.py` + `src/cartofia_bot/commands/basic.py`:

- Registers Discord slash commands
- Reads config from env (`src/cartofia_bot/config.py`)
- Uses Proxmox client (`src/cartofia_bot/proxmox_client.py`) for CT start/stop/status

## 3. Auth Model

Frontend:

- OIDC login flow in `account/index.html`
- Token-dependent UI behavior in `assets/site.js` and feature pages

Backend:

- Token validation via configured OIDC userinfo endpoint
- Group-based access control for archive visibility and upload

## 4. Multiplayer Model

Realtime multiplayer games use a room relay model:

- Browser connects to `/ws/<game>`
- Server stores room state in-memory
- Host/client payloads are relayed inside each room
- Room readiness and capacity rules are game-config driven

This is optimized for low complexity and fast iteration, not distributed scaling.

## 5. Infrastructure Intent

Deployment target is Proxmox-based home lab:

- Gateway/front-door container for public routing
- Internal container network for game and service workloads
- Discord bot container for orchestration and status commands

## 6. Current Technical Debt

- `api_server.py` is still monolithic
- Several frontend pages are large and inline-heavy
- No automated test suite or CI pipeline yet
- Large generated game artifacts are committed directly

## 7. Recommended Next Refactor Sequence

1. Split backend modules:
   - `api/auth.py`, `api/archive.py`, `api/profile.py`, `api/stats.py`, `api/ws.py`
2. Extract large inline game scripts into dedicated `game.js` modules
3. Add tests for:
   - auth helpers
   - profile/archive DB helpers
   - websocket room state logic
4. Add CI:
   - Python syntax/lint
   - optional frontend lint/build checks
5. Move large generated artifacts to release storage/CDN workflow
