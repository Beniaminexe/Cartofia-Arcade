# Cartofia TODO

## Immediate Quality Work

- [ ] Split `src/cartofia_bot/api_server.py` into feature modules.
- [ ] Add unit tests for auth/profile/archive helpers.
- [ ] Add websocket room-state tests for multiplayer reliability.
- [ ] Add CI workflow (lint + syntax + tests).
- [ ] Add production session/token hardening plan for account pages.

## Frontend Maintainability

- [ ] Move large inline scripts/CSS from pages into dedicated assets.
- [ ] Introduce per-page JS modules where game logic is still inline.
- [ ] Standardize reusable page shell components.

## Ops and Release

- [ ] Define release process for large generated artifacts (`cartofia-game.apk`, web build files).
- [ ] Add deployment checklist for API + static assets.
- [ ] Add rollback/runbook docs for infra outages.
