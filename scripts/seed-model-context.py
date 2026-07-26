#!/usr/bin/env python3
"""Seed contextWindow into local model.limits_json when missing."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".data" / "SYNC-THINK" / "sync-think.db"

# Reasonable defaults for the user's current catalog when not yet configured.
DEFAULT_CONTEXT = {
    "gpt-5.6-sol": 400_000,
    "gpt-5.6-terra": 400_000,
    "gpt-5.6-luna": 400_000,
    "gpt-5.5": 400_000,
    "grok-4.5": 500_000,
    "z-ai/glm-5.2": 200_000,
}


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"database not found: {DB}")
    conn = sqlite3.connect(DB)
    try:
        rows = conn.execute(
            "SELECT id, provider_model_id, display_name, limits_json FROM model"
        ).fetchall()
        updated = 0
        for model_id, provider_model_id, display_name, limits_json in rows:
            current = {}
            if limits_json:
                try:
                    parsed = json.loads(limits_json)
                    if isinstance(parsed, dict):
                        current = parsed
                except json.JSONDecodeError:
                    current = {}
            existing = current.get("contextWindow")
            if isinstance(existing, (int, float)) and existing > 0:
                print(f"keep {provider_model_id}: {int(existing)}")
                continue
            seeded = DEFAULT_CONTEXT.get(provider_model_id)
            if not seeded:
                print(f"skip {provider_model_id}: no default")
                continue
            current["contextWindow"] = seeded
            conn.execute(
                "UPDATE model SET limits_json=? WHERE id=?",
                (json.dumps(current, ensure_ascii=False), model_id),
            )
            updated += 1
            print(f"set {provider_model_id} ({display_name}) -> {seeded}")
        conn.commit()
        print(f"updated={updated}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
