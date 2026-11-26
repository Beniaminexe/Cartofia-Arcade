# Cartopoly — design

Cartofia's own property-trading board game for the arcade. **Design only —
no code yet.** Decisions from the 25 Nov 2026 brainstorm are recorded below;
the open questions at the end come before any build work.

## Pitch
A property-trading board game set in Cartofia's potato world, with Tofi as
the banker. Built to finish in **25–35 minutes** instead of two hours, and
played online, against bots, or a mix of both.

**Three pillars**
1. **Short sessions.** A browser game nobody finishes is a dead game.
2. **Trading is the game.** Dice are the clock; deals between players are
   where the fun and the skill are.
3. **The server runs everything, from day one** (the Blackjack lesson).
   Money, dice, cards and trades are never decided in the browser.

**Name and IP.** Hasbro has a history of going after "-opoly" names. Risk is
low for a hobby site, but everything else must be clearly original: no
Chance, Community Chest, Go to Jail, Free Parking, top-hat mascot or red-box
logo. Zero-risk fallback names: "Tuber Tycoon", "Spud Empire".

## Every rule is a lobby setting
The engine never hard-codes rules. It reads a settings bundle chosen by the
host in the lobby, locked when the game starts and shown to anyone who joins.

| Setting | Options |
|---|---|
| Board | Compact (32 spaces) · Classic (40 spaces) |
| How the game ends | Round limit, richest by net worth wins · Last player standing |
| Twist | Classic · Market events · Characters |
| Players | 2–6, any mix of humans and bots |
| Extras | Turn timer, speed die, starting properties dealt |

Boards are **data files** (spaces, prices, rents, groups), not code, so a
third board later is a new file.

**Presets** (individual toggles under "Custom"):

| Preset | Board | End | Twist | Notes |
|---|---|---|---|---|
| Quick | Compact | 15 rounds | Market events | 2 properties dealt each; ~25 min |
| Classic | Classic | Last player standing | None | The long game |
| Party | Compact | Round limit | Characters | 6 players |

## Compact board (32 spaces, 8 per side)
Chosen for phones: ~45 px squares on a 390 px screen instead of ~35 px, and
faster laps.

| Group (cheap → expensive) | Spaces |
|---|---|
| The Field | Seed Plot, Root Cellar, Compost Ridge |
| Market Lane | Sack Stall, Weigh Station, Farmers' Market |
| Chip Shop Row | Fryer Alley, Vinegar Square, The Chippy |
| Mash Quarter | Gravy Lane, Butter Bridge, Mash Hall |
| Rösti Riviera | Gnocchi Terrace, Rösti Promenade, Hash Brown Pier |
| Golden Fry Heights | Crisp Palace, Truffle Tower, Golden Fry Plaza |

- **Transport (4):** Spud Express — Tractor, Truck, Train, Airship.
- **Utilities (2):** Irrigation Works, Homelab Datacentre.
- **Corners:** Harvest (start; collect on passing) · Stuck in the Compost
  (jail) · Tofi's Picnic (free space) · Thrown in the Compost (go to jail).
- **Cards and tax:** two Spud Luck spaces, one Tofi's Pick space, one tax
  square — all original card text.
- **Buildings:** Sprouts (houses) and a Spud Tower (hotel).

The classic 40-space board is a second data file with its own tuned prices.

## Keeping games short
- Round limit, default 20, **scaled by player count**: 20 rounds for 2–3
  players, 15 for 4, 12 for 5–6 (six players × ~20 s × 20 rounds ≈ 40 min).
- Two random properties dealt to each player at the start, so trading
  starts on turn one.
- Every declined property goes straight to auction.
- Bulk building in one action; the even-building rule is applied
  automatically.
- 45-second turn timer; a bot takes over an AFK player's turn.
- Optional speed die ("blitz").

## Twists (all available as modes)
- **Market events.** Each round opens with an event card that changes the
  board for that round (e.g. a drought halves rent in The Field; a chip
  festival doubles rent on Chip Shop Row). Cheap to build.
- **Characters.** Play as Spud, Rösti, Gnocchi, Chip or Wedge (the existing
  bot names), each with one perk (e.g. Chip earns more from transport,
  Rösti builds cheaper). Most identity, hardest to balance.
- **Classic.** No twist.

## Hard parts
1. **Trade screen and trading bots** — the biggest job. Bots must value a
   set-completing trade properly or players will exploit them every game.
2. **Rules edge cases**, written down before code: mortgages and the
   interest on lifting them; bankruptcy to the bank vs to a player; auctions
   while someone is disconnected; leaving the compost with doubles.
3. **Balancing the money.** Bots play ~10,000 headless games per board and
   preset; tune until the average game is ~30 minutes and no group is always
   the right buy. Characters must each win no more than about 1 in 6 games.
4. **Phone layout.** Tap a square for a detail card (shows stacked tokens);
   the trade screen is a full-screen sheet.

## Architecture (same pattern as Ludo and Blackjack)
- **Rules engine** with a seeded RNG, so simulated games replay exactly.
- **Game server** over WebSocket: rooms, rejoin after disconnect, bot
  takeover, turn timers, auctions, trades.
- **Browser renderer only displays** server state and sends intents.
- **Stats and achievements recorded on the server.**
- **Game money is separate from casino chips.** Linking them would turn any
  money bug into a chip-minting bug.

**Security rule: anything the browser decides, the player can change.** If
the client decided outcomes, a player could give himself money, mark a trade
accepted that the other player never agreed to, peek at the next card or
event, or choose the next dice roll.

## Stats and achievements
Achievements count across every mode. Leaderboards ("fastest win",
"richest finish") are kept **per preset**, so compact and classic wins don't
compete on one board.

## Release plan
| Release | Contents |
|---|---|
| v1 | One board, both end modes, Classic + Market events twists, up to 6 players |
| v1.1 | The second board (needs only a second price table, tuned by the simulation) |
| v2 | Characters (needs per-character balancing) |

## Build order
1. Rules and economy: written rules, board data, bot simulation that tunes
   prices.
2. Engine and bots, with full tests.
3. Game server: rooms, turn timers, auctions, trades, rejoin.
4. Browser client: board graphics, trade sheet, phone layout.
5. Stats, achievements, polish.

One agent owns each step's files, as in the game redesigns.

## Decisions (25 Nov 2026)
- Both ways to end a game, chosen per lobby.
- Both board sizes, chosen per lobby.
- All twists available as game modes.
- Up to 6 players.

## Open questions
1. **Which board ships in v1:** compact 32 (recommended: faster, better on
   phones) or classic 40?
2. Then: the full tile list with prices and rents, the event-card deck, and
   the economy numbers (starting cash, Harvest payout, tax) — tuned by the
   simulation, not guessed.
