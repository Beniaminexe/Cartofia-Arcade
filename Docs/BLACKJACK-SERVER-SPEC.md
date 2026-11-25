# Server-authoritative Blackjack — build contract

## Why
Today the browser deals, decides each hand's outcome and POSTs
`/api/casino/blackjack/settle {bet, outcome, doubled}`. The server trusts the
outcome, so anyone can mint chips by POSTing `outcome: "blackjack"`. The full
remaining deck is also broadcast to every seat. And multiplayer has never
worked: the client's in-room messages carry no `type`, so the generic room
relay in `api_server.py` drops them and guests sit in the lobby forever.

Fix: the server owns the table, exactly like Ludo (`ludo/`). It shuffles,
deals, runs turns, plays the dealer, settles chips in the DB and records the
arcade result. The browser only sends intents and renders server state.

## Ownership
| Agent | Repo / files |
|---|---|
| BJ-SERVER | `/home/claude/cartofia-api`: new `blackjack/__init__.py`, `blackjack/engine.py`, `blackjack/server.py`, tests `tests/test_blackjack_*.py`; small edits in `api_server.py` (dispatch), `profile_routes.py` (retire settle), `arcade_stats.py` (server-side recording only) |
| BJ-CLIENT | `/home/claude/cartofia-arcade/arcade/blackjack/game.js` and `index.html` only. **Keep `render.js` / `render.css` as they are** (the renderer reads a view object; build it from server state). |

Nobody commits or pushes. Both work on the current checkouts (`wip/batch2` in
each repo).

## Rules (unchanged from today's client)
- Cards are 2-char strings: rank `A 2 3 4 5 6 7 8 9 T J Q K` + suit `S H D C` (e.g. `"AS"`, `"TH"`).
- One fresh shuffled 52-card deck per round (`secrets.SystemRandom`); if it runs out mid-round, append a freshly shuffled deck.
- Deal: each seat in `order` gets 2 cards, dealer gets 2 (second is the hole card).
- Hand value: aces 11 reduced to 1 while > 21. Natural = 2-card 21.
- Players act in `order`: `hit`, `stand`, `double` (only on the first two cards; doubles the stake, draws exactly one card, then the seat is done). No split, no insurance, no surrender.
- A seat with a natural, or reaching 21, or busting, is done automatically.
- Dealer then reveals and draws to 17+, stands on all 17s (soft too). If every seat busted, the dealer just reveals.
- Results, per seat, in this precedence (these exact strings — the client shows them):
  1. player natural and dealer natural → `"Push (both Blackjack)"` (delta 0)
  2. player natural → `"Blackjack! (3:2)"` (delta `floor(bet * 1.5)`)
  3. dealer natural → `"Lose (Dealer Blackjack)"` (delta −stake)
  4. player > 21 → `"Lose (Bust)"` (−stake)
  5. dealer > 21 → `"Win (Dealer bust)"` (+stake)
  6. player > dealer → `"Win"` (+stake); player < dealer → `"Lose"` (−stake); equal → `"Push"` (0)
  - stake = bet, or 2 × bet if doubled.

## Chips (casino_wallet in profiles DB, see `profile_routes.py`)
- Bets: `CASINO_MIN_BET`..`CASINO_MAX_BET`. A seat sets its bet in the lobby/between rounds (`bet` message). It must be ≤ the player's chips.
- At round start the server **escrows** each seat's bet (deduct from `casino_wallet.chips` in one transaction). A seat that can't cover its bet sits the round out (shown as not playing). Doubling escrows a second bet; if the wallet can't cover it, `double` is refused.
- At results the server pays out atomically (returns stake + winnings, or nothing on a loss) and updates `hands_played/won/lost/pushed`, `biggest_win`, `net_lifetime`, `updated_at` exactly as `settle_blackjack_hand` does today.
- Crash/restart safety: escrow and payout each in their own committed transaction; if the process dies mid-round, escrowed chips are lost only for that round (acceptable, document it). Never pay twice for a round (key by room code + round number).
- `/api/casino/blackjack/settle` → **410 Gone** `{ok:false, reason:"Blackjack is settled by the table server."}`. `/api/casino/wallet` and `/wallet/topup` stay as they are.
- Arcade stats: the server records each seated player's round via `arcade_stats` internal API (same `extra` shape the client used to send: `mode`, `outcome` in `win|blackjack|push|lose`, `doubled`, `bet`, `delta`) so achievements/leaderboards keep working. Client POSTs to `/api/arcade/games/blackjack/result` must now be rejected (403, like `ludo_*` self-awards) so stats can't be faked either.

## Identity
Same as Ludo: the WebSocket handshake resolves the user from the `cartofia_session` cookie (`auth_routes.load_session_from_cookie()`), falling back to nothing. **Guests can watch but can't take a seat** (send `error` "Sign in to play for chips."). Display name = profile display name / username (server-side, not client-supplied).

## WebSocket protocol — `/ws/rooms/blackjack`
`room_websocket` dispatches `game_type == "blackjack"` to `blackjack.server.handle_ws(ws)` (like `ludo`). Rooms live in memory (single process), with per-connection send locks (simple_websocket is not thread-safe), a ticker thread for turn timers, and room cleanup when empty.

Client → server (JSON, all have `type`):
- `{type:"create", password?}` → host of a new room (code: 6 chars A–Z/2–9 like today).
- `{type:"join", code, password?}` → seat if a seat is free (max 6) and signed in; otherwise spectator. Joining an unknown code → `error` "Room not found." (do NOT auto-create).
- `{type:"bet", amount}` → only while `phase` is `lobby` or `results`.
- `{type:"ready", ready: true|false}`
- `{type:"start"}` → host only; needs ≥1 seated player who is ready and can cover their bet (host counts as ready when they press start). Starts a round.
- `{type:"action", action:"hit"|"stand"|"double"}` → only the seat whose turn it is.
- `{type:"leave"}`, `{type:"heartbeat"}`

Server → client:
- `{type:"room", code, role:"host"|"seat"|"spectator", you: <seat id or null>}` once after create/join.
- `{type:"state", state}` after every change, **per recipient** (only `you` and `wallet` differ):
  ```
  state = {
    code, round, phase: "lobby"|"playing"|"dealer"|"results",
    host: <seat id>,
    seats: [{id, name, ready, bet, connected, playing}],   // seat order
    order: [seat ids playing this round],
    turn: <seat id or null>, turn_deadline: <epoch ms or null>,
    dealer: { cards: [visible cards only — hole card omitted until reveal], hidden: <bool hole card face down>, total: <total of visible cards> },
    hands:  { <id>: [cards] },
    totals: { <id>: {total, soft} },
    done:   { <id>: bool }, doubled: { <id>: bool }, blackjacks: { <id>: bool },
    results:{ <id>: "<result string>" }, payouts: { <id>: <delta int> },
    you: <seat id or null>,
    wallet: { chips, hands_played, hands_won, hands_lost, hands_pushed, biggest_win, net_lifetime } | null
  }
  ```
  Never include the deck or the hole card before reveal.
- `{type:"error", message}`
- `{type:"left"}` after leave.

Seat ids: stable per user within a room (e.g. the user id string). A user reconnecting (same account, new socket) resumes their seat.

Timers/disconnects: each turn has 30 s (`BJ_TURN_SECONDS` env, default 30); timeout or disconnect on your turn = `stand`. Between rounds nothing auto-starts. Host leaves → next seat becomes host. Room with no sockets for 60 s is deleted.

## Client (BJ-CLIENT) responsibilities
- Replace local dealing/deck/turn logic in `game.js` with a thin client: connect, send intents, mirror `state` into the existing `game` object shape the renderer's view builder expects (`phase`, `order`, `dealer.cards`/reveal, `hands`, `done`, `results`, `bets`, `doubled`, `blackjacks`), and render. Map `dealer.hidden` to the face-down hole card the renderer draws.
- Remove the client's `/api/casino/blackjack/settle` call and the blackjack `CartofiaGame.reportResult` call (server records both). Wallet shown from `state.wallet` (still load `/api/casino/wallet` on page load for the bankroll before joining; keep the existing "Claim free chips" top-up flow).
- Solo play = create a room and press Start Round (the host is the only seat). Lobby UI (create/join/password/ready/leave), Hit/Stand/Double buttons, bet +/- input and all element ids stay.
- Guests: can't sit; show the existing "Sign in to play for chips" state.

## Done means
- BJ-SERVER: engine unit tests (values, naturals, every result branch, dealer 17 rule, double, deck never leaks), server tests over real WebSockets (create/join/bet/start/actions/timeout/disconnect/reconnect/2–3 seats/host handover/escrow + payout exactly once, insufficient chips, guest can't sit, settle 410, client arcade POST 403), and the full existing suite still green.
- BJ-CLIENT: on the devstack, solo hands and a 2-browser table play to results with correct chips, zero console errors, 1280 and 390 screenshots in `/home/claude/ludo-shots/b5-blackjack-*.png`.
