# Batch 2 — owner findings (23 Nov 2026) → build contract

Source: owner's findings PDF. Five parallel agents. Work happens on branch
`wip/batch2` in BOTH repos (`/home/claude/cartofia-api`, `/home/claude/cartofia-arcade`).
`feature/ludo` is LIVE (production auto-pulls it every minute) — never push to it.

## Rules for every agent
- Edit ONLY the files you own (table below). If you need something from another
  area, code against the contract here and report the dependency.
- Never `git commit`/`push`/switch branches. The orchestrator commits checkpoints.
- Vanilla HTML/CSS/JS, no build tools, no CDNs (Google Fonts already used is fine).
  Bump `?v=` on any shared JS/CSS you change, on every page that loads it.
- Backend: Python 3.11, no new pip deps. Run `cd /home/claude/cartofia-api && python3 -m pytest tests/ -q` before reporting.
- Dev server: `DEVSTACK_DATA=/tmp/b2-<agent> python3 /home/claude/ludo-spec/devstack.py <port> --fresh`
  serves site + real API on one origin (also rewrites `/u/<name>`). Fake login:
  `/__dev/login?user=alice&next=/somewhere`. Ports: LUDO-BE 8910, LUDO-FE 8920, PROFILE 8930, STATS 8940, ARCADE 8950.
  Headless Chrome via Python Playwright works. Screenshots → `/home/claude/ludo-shots/b2-<agent>-*.png`.
- Usage budget is tight: no endless polish loops; one screenshot pass, fix, done.
- Accounts use the httpOnly `cartofia_session` cookie. Frontend: send credentials, add a Bearer
  header ONLY if a legacy `oidc_access_token` exists in storage. `/api/auth/me` = who am I.

## Ownership
| Agent | Owns |
|---|---|
| LUDO-BE | `cartofia-api/ludo/**`, `cartofia-api/tests/test_ludo_*.py` |
| LUDO-FE | `cartofia-arcade/arcade/ludo/**` |
| PROFILE | `u/index.html`, `account/index.html`, `account/profile/index.html`, new `achievements/index.html`, `assets/notifications.js`, `assets/notifications.css`, `cartofia-api/profile_routes.py`, the Discord functions in `cartofia-api/api_server.py` (only those), `cartofia-api/tests/test_profile_*.py` |
| STATS | new `cartofia-api/arcade_stats.py` + its registration line(s) in `api_server.py`, `cartofia-api/tests/test_arcade_stats.py`, `assets/game-utils.js`, new `assets/game-stats.js` + `assets/game-stats.css`, game folders `arcade/{snake,minesweeper,bomber-raid,word-puzzle,maze-chase,blackjack,zuma,chess,brick-blitz}/**` |
| ARCADE | `arcade/index.html` + new `arcade/arcade-v2.css` / `arcade/arcade-v2.js`, new `assets/games/*.svg`, home page `index.html` |

## Contracts between agents
- **Game art**: ARCADE creates original SVG cover art `/assets/games/<slug>.svg` for slugs
  `snake minesweeper bomber-raid word-puzzle maze-chase blackjack zuma chess brick-blitz cartofia ludo`
  (16:10 artwork, no text needed, distinct per game). Others reference that path with a
  graceful fallback (gradient) if it 404s.
- **Achievements page** (PROFILE): `/achievements/` lists EVERY achievement (earned + locked), grouped
  by game, from `GET /api/achievements/catalog` (PROFILE adds; returns the full `ACHIEVEMENT_CATALOG`
  incl. entries other modules registered). `?user=<slug>` shows that user's earned state.
  Deep link: `/achievements/#<achievement_id>` scrolls to + highlights it.
- **Per-game stats** (STATS): `arcade_stats.py` Blueprint:
  `GET /api/arcade/games` → `[{slug, name, players_total, top: [{username, display_name, avatar_url, value}]}]`;
  `GET /api/arcade/games/<slug>/leaderboard?metric=best_score|wins|games|playtime&limit=20`;
  `GET /api/arcade/games/<slug>/stats/me` and `/stats/<username>` → `{games_played, wins, best_score, total_playtime_seconds, last_played_at, achievements:[...]}`.
  Game achievements are registered into `profile_routes.ACHIEVEMENT_CATALOG` from `arcade_stats.py`
  at import (do NOT edit profile_routes.py); unlocked server-side when results are recorded.
  Ludo keeps its own `/api/ludo/*`.
- **Profile favorite-game cards** link to `/arcade/<slug>/` and show `/assets/games/<slug>.svg`.

## Item list → owner
PROFILE
1. Favorite-game cards: clickable (open the game), cover art from `/assets/games/<slug>.svg`.
2. Stats grid: "Games played" is wrong — find + fix the root cause in the data; replace that tile
   with **Friends** (count, links to the friends list). Keep the rest.
3. Profile achievements: show EARNED only, first ~6, rest behind "Show more"; each links to
   `/achievements/#<id>`. Build `/achievements/` (all, earned + locked, grouped by game).
4. Discord link card: fix linking (verify end to end on cookie sessions) and move it to a sensible place
   (account settings area, not mid-profile).
5. Friends: make the whole flow work (request/accept/decline/remove), friends list entries link to
   `/u/<slug>` showing their profile + stats.
6. Incoming friend request → toast popup + persistent notification in the top-right bell
   (bell lives in `notifications.js`; it was missing for cookie users — fixed in af4569a, build on it).
7. Recent activity: last 3, rest behind "Show more".
8. "Arcade records" section on profile is broken (only Ludo time looks right) — fix aggregation/display.
   If the root cause is how games report sessions (game-utils), tell STATS via your report.

LUDO-BE (engine + server) — LUDO-FE consumes; protocol additions below are binding
9. **Double Dice = sum**: throw 2 dice; a token on the board moves by a+b (exact finish still required).
   A yard token may exit if EITHER die is 6 (exits to start square, uses the throw). Extra roll only on
   a double six. three-sixes counter: a double-dice throw counts as one roll (six if double six).
   Remove phase `choose_die` / action `choose_die` (keep the event type harmless if referenced).
10. **Continue after a win**: when the first seat finishes all tokens and ≥1 other human remains,
    server sends each remaining non-retired human `continue_prompt {deadline_ms, winner_seat}` (20 s).
    Client answers `continue {yes: bool}`; broadcast `continue_status {seat, choice}`.
    No answer = no. A human who declines **retires**: tokens removed, NOT replaced by a bot, final
    placement below all players who keep playing, ordered among retirees by progress at retirement.
    If ≥1 human continues, play goes on (bots included) for the next places. Prompt only once,
    after the FIRST win. If no human continues,
    or only bots remain, the match ends (remaining placements by progress). Single human vs bots who
    loses the first place may continue vs bots. Stats recorded once at the true end.
11. **Play again keeps the room**: `play_again {}` after `match_end`: private room → everyone back in the
    SAME lobby (same code/seats/bots, ready reset, `room_update`); play_bots / quick match → new match
    immediately with the same settings for those who pressed it. Room survives 2 min after match_end.
12. **Chat**: `chat {text}` (lobby + match, ≤ 200 chars, trimmed, control chars stripped, 1 msg / 1.5 s);
    broadcast `chat {seat, name, text, ts}`; last 30 lines included in `room_update` / `match_start` as `chat_history`.
13. **Throwables**: `throw {target_seat, item}` items `tomato egg rose potato water confetti`;
    not at self; 1 / 3 s per sender; broadcast `throw {from_seat, target_seat, item}`.
    Tests for all of the above. README Ludo section updated.

LUDO-FE (renderer + UI)
14. Implement 9–13 in the UI: sum dice (two dice tumble, show total), continue prompt modal with
    countdown, Play again (same room), chat panel (lobby + in-game, unread badge on mobile), throwables
    with arc animation from thrower pod to target pod + splat/effect on the target avatar.
15. Clicking a player's avatar/pod opens a small menu: View profile (`/u/<username>` new tab, humans
    with accounts only), throw items, mute that player's chat/throws locally.
16. Match log: show only the latest line; the rest behind "Show more".
17. Ludo menu: put the power-up explainer UNDER the play options (and reachable below the board in-game),
    so the play buttons come first, especially on mobile.

STATS
18. Same kind of stats, leaderboards and achievements for the other games (not the Pygbag Cartofia game):
    reliable result reporting from each game (score/result/duration via game-utils), per-game stats +
    leaderboards API, 4–6 achievements per game, a "Stats & leaderboard" panel/modal on each game page.
    Client-reported scores are untrusted: clamp to sane bounds per game, rate-limit, ignore impossible values.

ARCADE
19. Rework the arcade page: cover art per game, top-player avatars on cards (from `/api/arcade/games`
    and `/api/ludo/leaderboard`), live player counts kept, nicer layout; free rein on a NEW theme for
    the arcade page only (whole site later). Do not depend on the untracked production-only
    `arcade/arcade.css` / `arcade.js` — build `arcade-v2.css/js` (tracked) and switch the page to them.
20. Home page on phones: the "What's inside" accordion item can't be closed — fix.

Not agent work (orchestrator/infra): Minecraft "create your own server" panel — frontend fixed in
af4569a (was hidden for cookie users); the controller error in the screenshot ("No route to host") is
the Minecraft controller host being unreachable → check on the server.
