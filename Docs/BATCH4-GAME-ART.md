# Batch 4: in-game graphical redesign (9 games)

One agent per game. The goal is to make each game *look* as good as Ludo
(`arcade/ludo/render.js`, `render.css`): depth, soft lighting, glossy pieces,
smooth motion, small satisfying effects. Gameplay must not change.

Not in scope: **Cartofia** (`arcade/cartofia/`). Do not touch it.

## Ownership (one agent each, edit ONLY these paths)

| Game | Files the agent may edit / add |
|---|---|
| blackjack | `arcade/blackjack/index.html`, `arcade/blackjack/game.js`, new files under `arcade/blackjack/` |
| bomber-raid | `arcade/bomber-raid/index.html`, new files under `arcade/bomber-raid/` |
| brick-blitz | `arcade/brick-blitz/index.html`, new files under `arcade/brick-blitz/` |
| chess | `arcade/chess/index.html`, `arcade/chess/game.js`, new files under `arcade/chess/` |
| maze-chase | `arcade/maze-chase/index.html`, new files under `arcade/maze-chase/` |
| minesweeper | `arcade/minesweeper/index.html`, new files under `arcade/minesweeper/` |
| snake | `arcade/snake/index.html`, new files under `arcade/snake/` |
| word-puzzle | `arcade/word-puzzle/index.html`, new files under `arcade/word-puzzle/` |
| zuma | `arcade/zuma/index.html`, `arcade/zuma/game.js`, new files under `arcade/zuma/` |

Shared files are READ-ONLY for every game agent: `assets/*`, `arcade/game-shell-v2.css`,
`arcade/game-common.css`, `arcade/game-utils.js`, `arcade/game-stats.*`, other games, the API.

## Art direction

- **Start from the game's cover art**: `assets/games/<slug>.svg`. The in-game look
  should feel like that cover came to life (same palette family, same shapes,
  same mood), sitting inside the Night Market page shell.
- Night Market tokens (already on the page as CSS vars): bg `#0a0818 / #0d0a1c / #141030`,
  accent violet `#7c5cff`, coral `#ff6b4a`, mint `#3ee6a6`, lemon `#ffcf5c`,
  text `#f5f0ff / #b3aacf`. Display font `Unbounded` (var `--font-display`).
  Respect the user's chosen accent theme where the game uses accent colours
  (read CSS vars at runtime, re-read on `cartofia:theme-changed`).
- Quality bar: Ludo. Gradients and highlights for volume, soft drop shadows,
  rounded forms, subtle board texture, readable at a glance. No flat
  placeholder rectangles, no emoji-as-graphics, no plain Unicode chess glyphs.
- **Motion**: ease pieces between positions, small particle bursts on key
  moments (eat, clear, capture, explosion, win), screen-shake only where it fits
  and never strong. Everything must honour `prefers-reduced-motion: reduce`
  (fall back to instant / fades).
- **Readability first**: state must be clearer than before, never less clear
  (colour-blind safe where colour carries meaning; add shape cues).

## Hard rules

1. **Gameplay identical**: rules, scoring, speed/timing, difficulty, controls,
   collision, RNG use, level data. Stats, achievements and `reportResult` calls
   unchanged. Multiplayer wire messages unchanged.
2. **Keep every element id, class and data-attribute that scripts or the shared
   shell rely on.** Don't remove the shell's pre-game / game-over cards, stats
   modal, side cards or touch pad.
3. **No network assets**: no CDNs, no web fonts beyond what the page already
   loads, no external images. Draw procedurally (canvas / inline SVG / CSS) or
   add small SVG/PNG files inside the game's own folder. Keep added assets small
   (aim < 150 KB total per game).
4. **Performance**: steady 60 fps on a mid phone. Canvas must be
   devicePixelRatio-aware (crisp on retina), cache static layers in offscreen
   canvases, no per-frame allocations in hot loops, no layout thrash.
5. **Responsive**: works at 1280×800 and 390×844, no horizontal overflow, touch
   still works.
6. If you change a script file's contents, bump its `?v=` in the HTML.
7. Do **not** commit or push. Report the files you changed.

## How to verify (each agent uses its own port + data dir)

```bash
DEVSTACK_DATA=/tmp/ds-<slug> python3 /home/claude/ludo-spec/devstack.py <port> --fresh &
# sign in:  http://127.0.0.1:<port>/__dev/login?user=alice&next=/arcade/<slug>/
```

Use Playwright (Python, headless Chromium, already installed). Before you
change anything, take BEFORE screenshots in-game at 1280 and 390. After: AFTER
screenshots of pre-game, mid-game and game-over states at both widths, saved as
`/home/claude/ludo-shots/b4-<slug>-*.png`, plus a side-by-side
`b4-<slug>-compare.png`. Prove: zero console errors / page errors, the game is
actually playable (drive real input and confirm state changes), score reporting
still fires (watch for the `/api/profile/me/activity` or arcade stats POST),
no overflow, and a reduced-motion run (`reduced_motion="reduce"`) has no errors.
Stop your devstack when done.
