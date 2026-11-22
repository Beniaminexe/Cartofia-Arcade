/* Dev-only scripted fixtures for render-demo.html.
   Builds wire-format states (§6) and event sequences (§7); `reduce()` computes the
   final state for each playEvents() call the way the server would. */
(function () {
  'use strict';
  const NAMES = ['Stefan', 'Ada', 'Linus', 'Grace'];
  const LEVELS = [7, 12, null, 3];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const prog = (seat, abs) => (((abs - seat * 13) % 52) + 52) % 52;

  function mkState(o) {
    o = o || {};
    const active = o.active || [0, 1, 2, 3];
    const tokens = [0, 1, 2, 3].map((s) => (o.tokens && o.tokens[s] ? o.tokens[s].slice() : [-1, -1, -1, -1]));
    const players = [0, 1, 2, 3].map((s) => ({
      seat: s, active: active.indexOf(s) >= 0, inventory: (o.inv && o.inv[s]) || [],
      frozen: !!(o.frozen && o.frozen.indexOf(s) >= 0), resigned: !!(o.resigned && o.resigned.indexOf(s) >= 0),
      finished_tokens: tokens[s].filter((t) => t === 56).length, placement: null, stats: {}
    }));
    const seats = [0, 1, 2, 3].map((s) => active.indexOf(s) < 0 ? null : {
      seat: s, name: (o.names && o.names[s]) || NAMES[s], kind: s === 0 ? 'human' : (o.humans && o.humans.indexOf(s) >= 0 ? 'guest' : 'bot'),
      username: s === 0 ? 'stefan' : null, avatar_url: (o.avatars && o.avatars[s]) || null,
      connected: !(o.offline && o.offline.indexOf(s) >= 0), autopilot: !!(o.afk && o.afk.indexOf(s) >= 0), level: LEVELS[s]
    });
    return {
      v: 1, mode: o.mode || 'power', status: o.status || 'playing', active_seats: active, tokens: tokens, players: players,
      shields: o.shields || [], crates: o.crates || [], bombs: o.bombs || [],
      turn: { number: 9, seat: o.turn == null ? 0 : o.turn, phase: o.phase || 'roll', dice: o.dice || [], value: o.value == null ? null : o.value, boost: 0,
        sixes_in_row: 0, power_used: false, double_pending: false, legal_moves: [], can_pass: false, deadline_ms: null, turn_seconds: 20 },
      placements: [], winner: null, match_id: 'm_demo', seats: seats
    };
  }

  function reduce(state, events) {
    const st = clone(state);
    const P = (s) => st.players[s];
    (events || []).forEach((e) => {
      switch (e.type) {
        case 'turn_start': Object.assign(st.turn, { seat: e.seat, number: e.number, phase: 'roll', dice: [], value: null, boost: 0, double_pending: false, power_used: false }); break;
        case 'turn_skipped': if (e.reason === 'frozen') P(e.seat).frozen = false; break;
        case 'rolled': Object.assign(st.turn, { seat: e.seat, dice: e.dice.slice(), value: e.value, phase: e.value == null ? 'choose_die' : 'move', double_pending: false }); break;
        case 'die_chosen': Object.assign(st.turn, { value: e.value, phase: 'move' }); break;
        case 'moved': st.tokens[e.seat][e.token] = e.to; st.turn.boost = 0; break;
        case 'captured': st.tokens[e.victim_seat][e.victim_token] = -1; break;
        case 'bomb_triggered': st.bombs = st.bombs.filter((b) => b.abs !== e.abs); if (!e.defused) st.tokens[e.seat][e.token] = -1; break;
        case 'crate_collected': st.crates = st.crates.filter((a) => a !== e.abs); P(e.seat).inventory.push(e.power); break;
        case 'crate_spawned': st.crates.push(e.abs); break;
        case 'power_used': {
          const inv = P(e.seat).inventory, j = inv.indexOf(e.power);
          if (j >= 0) inv.splice(j, 1);
          st.turn.power_used = true;
          if (e.power === 'shield') st.shields.push({ seat: e.seat, token: e.target.token, rounds_left: 2 });
          if (e.power === 'boost') st.turn.boost = 3;
          if (e.power === 'double_dice') st.turn.double_pending = true;
          if (e.power === 'reroll') { st.turn.dice = []; st.turn.value = null; }
          break;
        }
        case 'bomb_placed': st.bombs = st.bombs.filter((b) => b.seat !== e.seat); st.bombs.push({ seat: e.seat, abs: e.abs }); break;
        case 'frozen': P(e.seat).frozen = true; break;
        case 'swapped': st.tokens[e.seat][e.token] = prog(e.seat, e.abs_a); st.tokens[e.target_seat][e.target_token] = prog(e.target_seat, e.abs_b); break;
        case 'shield_expired': st.shields = st.shields.filter((x) => !(x.seat === e.seat && x.token === e.token)); break;
        case 'token_finished': P(e.seat).finished_tokens = st.tokens[e.seat].filter((t) => t === 56).length; st.shields = st.shields.filter((x) => !(x.seat === e.seat && x.token === e.token)); break;
        case 'resigned': P(e.seat).resigned = true; st.tokens[e.seat] = [-1, -1, -1, -1]; st.shields = st.shields.filter((x) => x.seat !== e.seat); st.bombs = st.bombs.filter((b) => b.seat !== e.seat); break;
        case 'game_over': st.status = 'finished'; st.winner = e.winner; st.placements = e.placements.slice(); e.placements.forEach((s, j) => { P(s).placement = j + 1; }); break;
      }
    });
    return st;
  }
  const path = (from, to) => { const p = []; for (let i = Math.max(0, from + 1); i <= to; i++) p.push(i); return p; };
  const mv = (seat, token, from, to, boost) => ({ type: 'moved', seat: seat, token: token, from: from, to: to, path: from < 0 ? [0] : path(from, to), boost: boost || 0 });
  const roll = (seat, v) => ({ type: 'rolled', seat: seat, dice: Array.isArray(v) ? v : [v], value: Array.isArray(v) && v.length > 1 ? null : (Array.isArray(v) ? v[0] : v) });
  const ts = (seat, n) => ({ type: 'turn_start', seat: seat, number: n || 10 });

  /* Each scenario: { title, group, state, steps: [ {events, pause?, before?(r, st), after?(r, st)} ] } */
  const S = {};
  const base = {
    tokens: [[5, 22, -1, -1], [3, 30, -1, 51], [12, -1, -1, -1], [40, 2, -1, -1]],
    crates: [17, 35, 44, 10], inv: [['shield', 'bomb'], ['freeze'], [], ['swap']]
  };

  S.midgame = {
    title: 'Mid-game showcase', group: 'Board',
    state: mkState({
      tokens: [[5, 22, 56, -1], [3, 30, -1, 52], [12, 33, -1, -1], [44, 2, -1, -1]],
      crates: [17, 36, 44, 10], bombs: [{ seat: 1, abs: 24 }, { seat: 3, abs: 50 }],
      shields: [{ seat: 0, token: 1, rounds_left: 2 }, { seat: 2, token: 0, rounds_left: 1 }],
      inv: [['shield', 'bomb'], ['freeze', 'boost'], [], ['swap']], frozen: [2], afk: [3], offline: [3], turn: 0, phase: 'roll'
    }),
    steps: [{ events: [], after: (r) => { r.setDice({ seat: 0, values: [], phase: 'roll', enabled: true }); r.setTimer(0, Date.now() + 14000, 20000); r.setSelectable([]); } }]
  };

  S.roll_move = {
    title: 'Roll + hop', group: 'Moves',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44, 50], inv: base.inv, turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 5)], pause: 1100, after: (r) => r.setSelectable([{ seat: 0, token: 0 }, { seat: 0, token: 1 }]) },
      { before: (r) => r.setSelectable([]), events: [mv(0, 0, 5, 10), ts(1)] },
      { events: [roll(1, 4)] },
      { events: [mv(1, 1, 30, 34), ts(2)] }
    ]
  };

  S.yard_exit = {
    title: 'Yard exit on 6', group: 'Moves',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 2 }),
    steps: [
      { events: [ts(2), roll(2, 6)] },
      { events: [mv(2, 1, -1, 0), { type: 'extra_turn', seat: 2, reasons: ['six'] }] },
      { events: [roll(2, 6)] },
      { events: [mv(2, 2, -1, 0), { type: 'extra_turn', seat: 2, reasons: ['six'] }] }
    ]
  };

  S.capture = {
    title: 'Capture', group: 'Moves',
    state: mkState({ tokens: [[20, 22, -1, -1], [4, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [36, 44], turn: 1 }),
    steps: [
      { events: [ts(1), roll(1, 3)] },
      { events: [mv(1, 0, 4, 7), { type: 'captured', seat: 1, token: 0, victim_seat: 0, victim_token: 0, abs: 20 }, { type: 'extra_turn', seat: 1, reasons: ['capture'] }] }
    ]
  };

  S.capture_me = {
    title: 'Capture (by me)', group: 'Moves',
    state: mkState({ tokens: [[16, 22, -1, -1], [6, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [36, 44], turn: 0 }),
    steps: [
      { events: [ts(0), roll(0, 3)] },
      { events: [mv(0, 0, 16, 19), { type: 'captured', seat: 0, token: 0, victim_seat: 1, victim_token: 0, abs: 19 }, { type: 'extra_turn', seat: 0, reasons: ['capture'] }] }
    ]
  };

  S.crate = {
    title: 'Crate collect + respawn', group: 'Power-ups',
    state: mkState({ tokens: [[10, 22, -1, -1], [3, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [14, 35, 44, 50], inv: [['bomb'], [], [], []], turn: 0 }),
    steps: [
      { events: [ts(0), roll(0, 4)] },
      { events: [mv(0, 0, 10, 14), { type: 'crate_collected', seat: 0, token: 0, abs: 14, power: 'shield' }, ts(1), { type: 'crate_spawned', abs: 31 }] },
      { events: [roll(1, 2)] },
      { events: [mv(1, 1, 30, 32), ts(2)] }
    ]
  };

  S.crate_full = {
    title: 'Crate (inventory full)', group: 'Power-ups',
    state: mkState({ tokens: [[10, 22, -1, -1], [3, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [14, 35, 44], inv: [['bomb', 'freeze'], [], [], []], turn: 0 }),
    steps: [{ events: [ts(0), roll(0, 4)] }, { events: [mv(0, 0, 10, 14), { type: 'crate_full', seat: 0, abs: 14 }, ts(1)] }]
  };

  S.double_dice = {
    title: 'Double Dice', group: 'Power-ups',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: [['double_dice', 'bomb'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), { type: 'power_used', seat: 0, power: 'double_dice', target: {} }] },
      { events: [roll(0, [3, 5])], pause: 1400, after: (r) => r.setDice({ seat: 0, values: [3, 5], phase: 'choose_die', enabled: true }) },
      { events: [{ type: 'die_chosen', seat: 0, value: 5 }], pause: 500 },
      { events: [mv(0, 1, 22, 27), ts(1)] }
    ]
  };

  S.reroll = {
    title: 'Re-roll', group: 'Power-ups',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: [[], ['reroll'], [], []], turn: 0 }),
    steps: [
      { events: [ts(1), roll(1, 1)], pause: 500 },
      { events: [{ type: 'power_used', seat: 1, power: 'reroll', target: {} }, roll(1, 6)] },
      { events: [mv(1, 2, -1, 0), { type: 'extra_turn', seat: 1, reasons: ['six'] }] }
    ]
  };

  S.boost = {
    title: 'Rocket boost', group: 'Power-ups',
    state: mkState({ tokens: [[5, 22, -1, -1], [3, 33, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44, 50], inv: [['boost'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 4)], pause: 400 },
      { events: [{ type: 'power_used', seat: 0, power: 'boost', target: { amount: 3 } }] },
      { events: [mv(0, 1, 22, 29, 3), ts(1)] }
    ]
  };

  S.shield = {
    title: 'Shield: apply, block, expire', group: 'Power-ups',
    state: mkState({ tokens: [[30, 5, -1, -1], [14, -1, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44], inv: [['shield'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), { type: 'power_used', seat: 0, power: 'shield', target: { token: 0 } }] },
      { events: [roll(0, 2)] },
      { events: [mv(0, 1, 5, 7), ts(1)] },
      { events: [roll(1, 3)] },
      { events: [mv(1, 0, 14, 17), { type: 'shield_blocked', seat: 1, token: 0, victim_seat: 0, victim_token: 0, abs: 30 }, ts(2)] },
      { pause: 400, events: [ts(0, 12), { type: 'shield_expired', seat: 0, token: 0 }] }
    ]
  };

  S.freeze = {
    title: 'Freeze + skipped turn', group: 'Power-ups',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: [['freeze'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), { type: 'power_used', seat: 0, power: 'freeze', target: { target_seat: 2 } }, { type: 'frozen', seat: 2, by: 0 }] },
      { events: [roll(0, 3)] },
      { events: [mv(0, 0, 5, 8), ts(1)] },
      { events: [roll(1, 2)] },
      { events: [mv(1, 0, 3, 5), ts(2), { type: 'turn_skipped', seat: 2, reason: 'frozen' }, ts(3)] }
    ]
  };

  S.bomb = {
    title: 'Bomb: plant + explode', group: 'Power-ups',
    state: mkState({ tokens: [[5, 22, -1, -1], [3, -1, -1, -1], [4, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44], inv: [['bomb'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), { type: 'power_used', seat: 0, power: 'bomb', target: { abs: 33 } }, { type: 'bomb_placed', seat: 0, abs: 33, replaced_abs: null }] },
      { events: [roll(0, 1)] },
      { events: [mv(0, 1, 22, 23), ts(1)] },
      { events: [roll(1, 2)] },
      { events: [mv(1, 0, 3, 5), ts(2)] },
      { events: [roll(2, 3)] },
      { events: [mv(2, 0, 4, 7), { type: 'bomb_triggered', seat: 2, token: 0, bomb_seat: 0, abs: 33, defused: false }, ts(3)] }
    ]
  };

  S.bomb_defused = {
    title: 'Bomb defused by shield', group: 'Power-ups',
    state: mkState({ tokens: [[42, 22, -1, -1], [3, -1, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17], bombs: [{ seat: 3, abs: 45 }], shields: [{ seat: 0, token: 0, rounds_left: 2 }], turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 3)] },
      { events: [mv(0, 0, 42, 45), { type: 'bomb_triggered', seat: 0, token: 0, bomb_seat: 3, abs: 45, defused: true }, ts(1)] }
    ]
  };

  S.bomb_replace = {
    title: 'Bomb replaced', group: 'Power-ups',
    state: mkState({ tokens: base.tokens, crates: [17], bombs: [{ seat: 0, abs: 20 }], inv: [['bomb'], [], [], []], turn: 3 }),
    steps: [{ events: [ts(0), { type: 'power_used', seat: 0, power: 'bomb', target: { abs: 46 } }, { type: 'bomb_placed', seat: 0, abs: 46, replaced_abs: 20 }] }]
  };

  S.swap = {
    title: 'Swap', group: 'Power-ups',
    state: mkState({ tokens: [[5, 22, -1, -1], [3, -1, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44], inv: [['swap'], [], [], []], turn: 3 }),
    steps: [
      { events: [ts(0), { type: 'power_used', seat: 0, power: 'swap', target: { token: 0, target_seat: 3, target_token: 0 } }, { type: 'swapped', seat: 0, token: 0, target_seat: 3, target_token: 0, abs_a: 27, abs_b: 5 }] },
      { events: [roll(0, 2)] }
    ]
  };

  S.finish = {
    title: 'Token finishes', group: 'Moves',
    state: mkState({ tokens: [[53, 22, 56, -1], [3, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44], turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 3)] },
      { events: [mv(0, 0, 53, 56), { type: 'token_finished', seat: 0, token: 0 }, { type: 'extra_turn', seat: 0, reasons: ['finish'] }] }
    ]
  };

  S.skips = {
    title: 'Skips: 3 sixes, no moves, pass', group: 'Moves',
    state: mkState({ tokens: [[-1, -1, -1, -1], [3, 30, -1, -1], [12, -1, -1, -1], [40, 2, -1, -1]], crates: [17, 44], turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 2)] },
      { events: [{ type: 'turn_skipped', seat: 0, reason: 'no_moves' }, ts(1), roll(1, 6)] },
      { events: [mv(1, 0, 3, 9), { type: 'extra_turn', seat: 1, reasons: ['six'] }, roll(1, 6)] },
      { events: [mv(1, 0, 9, 15), { type: 'extra_turn', seat: 1, reasons: ['six'] }, roll(1, 6)] },
      { events: [{ type: 'turn_skipped', seat: 1, reason: 'three_sixes' }, ts(2), roll(2, 3)] },
      { events: [{ type: 'turn_skipped', seat: 2, reason: 'pass' }, ts(3)] }
    ]
  };

  S.stacks = {
    title: 'Stacked tokens', group: 'Board',
    state: mkState({
      tokens: [[8, 8, 56, 53], [prog(1, 8), 20, 20, 56], [prog(2, 8), 52, 52, 56], [12, 12, 12, 56]],
      crates: [30], turn: 0, phase: 'move', dice: [4], value: 4
    }),
    steps: [{ events: [], after: (r) => { r.setSelectable([{ seat: 0, token: 0 }, { seat: 0, token: 1 }, { seat: 0, token: 3 }]); r.setDice({ seat: 0, values: [4], phase: 'move', enabled: false }); } }]
  };

  S.win = {
    title: 'Win + confetti', group: 'Moves',
    state: mkState({ tokens: [[56, 56, 56, 52], [3, 30, 56, -1], [12, 45, -1, -1], [40, 2, -1, -1]], crates: [17, 44], turn: 3 }),
    steps: [
      { events: [ts(0), roll(0, 4)] },
      { events: [mv(0, 3, 52, 56), { type: 'token_finished', seat: 0, token: 3 }, { type: 'game_over', placements: [0, 1, 2, 3], winner: 0 }] }
    ]
  };

  S.resign = {
    title: 'Resign', group: 'Moves',
    state: mkState({ tokens: base.tokens, crates: [17, 35], bombs: [{ seat: 3, abs: 46 }], shields: [{ seat: 3, token: 0, rounds_left: 2 }], turn: 1 }),
    steps: [{ events: [{ type: 'resigned', seat: 3 }] }]
  };

  S.emotes = {
    title: 'Emotes + timer + flash', group: 'UI',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 0 }),
    steps: [{ events: [], after: async (r, sleep) => {
      r.setTimer(0, Date.now() + 6000, 20000);
      r.showEmote(0, '👍'); await sleep(250); r.showEmote(1, '😂'); await sleep(250); r.showEmote(2, '🔥'); await sleep(250); r.showEmote(3, '🥔');
      await sleep(900); r.flash('Your turn!', 'info'); await sleep(1400); r.flash('Ouch!', 'bad');
    } }]
  };

  S.target_token = {
    title: 'Targeting: own token (Shield)', group: 'UI',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 0 }),
    steps: [{ events: [], after: (r) => r.setTargeting({ kind: 'own_token', valid: [{ seat: 0, token: 0 }, { seat: 0, token: 1 }] }) }]
  };
  S.target_opp = {
    title: 'Targeting: opponent token (Swap)', group: 'UI',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 0 }),
    steps: [{ events: [], after: (r) => r.setTargeting({ kind: 'opponent_token', valid: [{ seat: 1, token: 0 }, { seat: 1, token: 1 }, { seat: 2, token: 0 }, { seat: 3, token: 0 }] }) }]
  };
  S.target_square = {
    title: 'Targeting: square (Bomb)', group: 'UI',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 0 }),
    steps: [{ events: [], after: (r) => r.setTargeting({ kind: 'square', valid: [6, 7, 9, 11, 12, 14, 15, 16, 18, 19, 20] }) }]
  };
  S.target_seat = {
    title: 'Targeting: seat (Freeze)', group: 'UI',
    state: mkState({ tokens: base.tokens, crates: [17, 35, 44], inv: base.inv, turn: 0 }),
    steps: [{ events: [], after: (r) => r.setTargeting({ kind: 'seat', valid: [1, 2, 3] }) }]
  };

  S.p2 = { title: '2 players', group: 'Layouts', state: mkState({ active: [0, 2], tokens: [[5, 22, -1, -1], [-1, -1, -1, -1], [12, 30, -1, -1], [-1, -1, -1, -1]], crates: [17, 44, 35], turn: 2 }), steps: [{ events: [] }] };
  S.p3 = { title: '3 players', group: 'Layouts', state: mkState({ active: [0, 1, 2], tokens: [[5, 22, -1, -1], [3, 30, -1, -1], [12, -1, -1, -1], [-1, -1, -1, -1]], crates: [17, 44, 35, 40], turn: 1 }), steps: [{ events: [] }] };
  S.waiting = { title: 'Waiting (pre-start)', group: 'Layouts', state: mkState({ status: 'waiting', turn: null }), steps: [{ events: [] }] };

  window.LudoDemo = { mkState: mkState, reduce: reduce, scenarios: S, prog: prog };
})();
