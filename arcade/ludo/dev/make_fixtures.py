#!/usr/bin/env python3
"""Dump real engine output for the renderer harness (dev only, not shipped logic).

Runs seeded bot-vs-bot games with the real ENGINE (cartofia-api/ludo/engine.py +
bot.py) and writes, per game, the initial state plus every apply()'s
{seat, action, events, state} to dev/fixtures/*.json. The harness replays these
through LudoRenderer.playEvents() to validate against real event streams.

Usage:  python3 make_fixtures.py [--api /home/claude/cartofia-api] [--scan 40]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures"
NAMES = ["Stefan", "Ada Bot", "Linus Bot", "Grace Bot"]


def seats_part(active, seat_names=NAMES):
    seats = []
    for s in range(4):
        if s not in active:
            seats.append(None)
            continue
        human = s == 0
        seats.append({
            "seat": s, "name": seat_names[s], "kind": "human" if human else "bot",
            "username": "stefan" if human else None, "avatar_url": None,
            "connected": True, "autopilot": False, "level": 7 if human else None,
        })
    return seats


def with_server(state, active):
    st = dict(state)
    st["match_id"] = "m_fixture"
    st["seats"] = seats_part(active)
    turn = dict(st.get("turn") or {})
    turn.setdefault("turn_seconds", 20)
    st["turn"] = turn
    return st


def play(LudoGame, choose_action, seed, active, mode, max_applies=4000):
    rng = random.Random(seed)
    g = LudoGame(active_seats=list(active), mode=mode, rng=random.Random(seed * 7 + 1), config={"end_rule": "first"})
    first = g.start()
    steps = [{"seat": None, "action": None, "events": first, "state": with_server(g.to_dict(), active)}]
    initial = with_server(g.to_dict(), active)
    n = 0
    while g.status == "playing" and n < max_applies:
        seat = g.current_seat
        act = choose_action(g, seat, rng=rng)
        if act is None:
            break
        ev = g.apply(seat, act)
        steps.append({"seat": seat, "action": act, "events": ev, "state": with_server(g.to_dict(), active)})
        n += 1
    types = {}
    for st in steps:
        for e in st["events"]:
            types[e["type"]] = types.get(e["type"], 0) + 1
    return {"seed": seed, "mode": mode, "active_seats": list(active), "initial": initial,
            "steps": steps, "event_counts": types, "finished": g.status == "finished"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="/home/claude/cartofia-api")
    ap.add_argument("--scan", type=int, default=40, help="seeds to scan for best event coverage")
    a = ap.parse_args()
    sys.path.insert(0, a.api)
    from ludo.engine import LudoGame  # noqa: E402
    from ludo.bot import choose_action  # noqa: E402

    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [("real-game.json", "power", [0, 1, 2, 3]), ("real-game-classic.json", "classic", [0, 1, 2])]
    for fname, mode, active in jobs:
        best = None
        for seed in range(1, a.scan + 1):
            game = play(LudoGame, choose_action, seed, active, mode)
            if not game["finished"]:
                continue
            cover = len(game["event_counts"])
            score = (cover, -len(game["steps"]))
            if best is None or score > best[0]:
                best = (score, game)
        game = best[1]
        (OUT / fname).write_text(json.dumps(game, separators=(",", ":")))
        print(f"{fname}: seed={game['seed']} applies={len(game['steps'])} types={len(game['event_counts'])}")
        print("   ", json.dumps(game["event_counts"], sort_keys=True))


if __name__ == "__main__":
    main()
