#!/usr/bin/env python3
"""Import researched model pricing into local app_setting['model-pricing']."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".data" / "SYNC-THINK" / "sync-think.db"

# Mirrors packages/protocol/src/commands.ts DEFAULT_MODEL_PRICING
PRICING = [
    # Anthropic
    {
        "modelId": "claude-fable-5",
        "displayName": "Claude Fable 5",
        "currency": "USD",
        "inputPerMillion": 10,
        "outputPerMillion": 50,
        "cacheReadPerMillion": 1,
        "cacheWritePerMillion": 12.5,
    },
    {
        "modelId": "claude-mythos-5",
        "displayName": "Claude Mythos 5",
        "currency": "USD",
        "inputPerMillion": 10,
        "outputPerMillion": 50,
        "cacheReadPerMillion": 1,
        "cacheWritePerMillion": 12.5,
    },
    {
        "modelId": "claude-opus-5",
        "displayName": "Claude Opus 5",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-8",
        "displayName": "Claude Opus 4.8",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-7",
        "displayName": "Claude Opus 4.7",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-6",
        "displayName": "Claude Opus 4.6",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-5",
        "displayName": "Claude Opus 4.5",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-5-20251101",
        "displayName": "Claude Opus 4.5",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 25,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 6.25,
    },
    {
        "modelId": "claude-opus-4-1",
        "displayName": "Claude Opus 4.1",
        "currency": "USD",
        "inputPerMillion": 15,
        "outputPerMillion": 75,
        "cacheReadPerMillion": 1.5,
        "cacheWritePerMillion": 18.75,
    },
    {
        "modelId": "claude-opus-4-1-20250805",
        "displayName": "Claude Opus 4.1",
        "currency": "USD",
        "inputPerMillion": 15,
        "outputPerMillion": 75,
        "cacheReadPerMillion": 1.5,
        "cacheWritePerMillion": 18.75,
    },
    {
        "modelId": "claude-opus-4",
        "displayName": "Claude Opus 4",
        "currency": "USD",
        "inputPerMillion": 15,
        "outputPerMillion": 75,
        "cacheReadPerMillion": 1.5,
        "cacheWritePerMillion": 18.75,
    },
    {
        "modelId": "claude-opus-4-20250514",
        "displayName": "Claude Opus 4",
        "currency": "USD",
        "inputPerMillion": 15,
        "outputPerMillion": 75,
        "cacheReadPerMillion": 1.5,
        "cacheWritePerMillion": 18.75,
    },
    {
        "modelId": "claude-sonnet-5",
        "displayName": "Claude Sonnet 5",
        "currency": "USD",
        "inputPerMillion": 2,
        "outputPerMillion": 10,
        "cacheReadPerMillion": 0.2,
        "cacheWritePerMillion": 2.5,
    },
    {
        "modelId": "claude-sonnet-4-6",
        "displayName": "Claude Sonnet 4.6",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 3.75,
    },
    {
        "modelId": "claude-sonnet-4-5",
        "displayName": "Claude Sonnet 4.5",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 3.75,
    },
    {
        "modelId": "claude-sonnet-4-5-20250929",
        "displayName": "Claude Sonnet 4.5",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 3.75,
    },
    {
        "modelId": "claude-sonnet-4",
        "displayName": "Claude Sonnet 4",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 3.75,
    },
    {
        "modelId": "claude-haiku-4-5",
        "displayName": "Claude Haiku 4.5",
        "currency": "USD",
        "inputPerMillion": 1,
        "outputPerMillion": 5,
        "cacheReadPerMillion": 0.1,
        "cacheWritePerMillion": 1.25,
    },
    {
        "modelId": "claude-haiku-4-5-20251001",
        "displayName": "Claude Haiku 4.5",
        "currency": "USD",
        "inputPerMillion": 1,
        "outputPerMillion": 5,
        "cacheReadPerMillion": 0.1,
        "cacheWritePerMillion": 1.25,
    },
    {
        "modelId": "claude-3-5-haiku-20241022",
        "displayName": "Claude 3.5 Haiku",
        "currency": "USD",
        "inputPerMillion": 0.8,
        "outputPerMillion": 4,
        "cacheReadPerMillion": 0.08,
        "cacheWritePerMillion": 1,
    },
    {
        "modelId": "claude-3-5-sonnet-20241022",
        "displayName": "Claude 3.5 Sonnet",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 3.75,
    },
    # OpenAI
    {
        "modelId": "gpt-5.6-sol",
        "displayName": "GPT-5.6 Sol",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 30,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.6-terra",
        "displayName": "GPT-5.6 Terra",
        "currency": "USD",
        "inputPerMillion": 2.5,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.25,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.6-luna",
        "displayName": "GPT-5.6 Luna",
        "currency": "USD",
        "inputPerMillion": 1,
        "outputPerMillion": 6,
        "cacheReadPerMillion": 0.1,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.5",
        "displayName": "GPT-5.5",
        "currency": "USD",
        "inputPerMillion": 5,
        "outputPerMillion": 30,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.5-pro",
        "displayName": "GPT-5.5 Pro",
        "currency": "USD",
        "inputPerMillion": 30,
        "outputPerMillion": 180,
        "cacheReadPerMillion": 0,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.4",
        "displayName": "GPT-5.4",
        "currency": "USD",
        "inputPerMillion": 2.5,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.25,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.4-mini",
        "displayName": "GPT-5.4 Mini",
        "currency": "USD",
        "inputPerMillion": 0.75,
        "outputPerMillion": 4.5,
        "cacheReadPerMillion": 0.075,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.4-nano",
        "displayName": "GPT-5.4 Nano",
        "currency": "USD",
        "inputPerMillion": 0.2,
        "outputPerMillion": 1.25,
        "cacheReadPerMillion": 0.02,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.4-pro",
        "displayName": "GPT-5.4 Pro",
        "currency": "USD",
        "inputPerMillion": 30,
        "outputPerMillion": 180,
        "cacheReadPerMillion": 0,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-5.3-codex",
        "displayName": "GPT-5.3 Codex",
        "currency": "USD",
        "inputPerMillion": 1.75,
        "outputPerMillion": 14,
        "cacheReadPerMillion": 0.175,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-4o",
        "displayName": "GPT-4o",
        "currency": "USD",
        "inputPerMillion": 2.5,
        "outputPerMillion": 10,
        "cacheReadPerMillion": 1.25,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-4o-mini",
        "displayName": "GPT-4o Mini",
        "currency": "USD",
        "inputPerMillion": 0.15,
        "outputPerMillion": 0.6,
        "cacheReadPerMillion": 0.075,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-4.1",
        "displayName": "GPT-4.1",
        "currency": "USD",
        "inputPerMillion": 2,
        "outputPerMillion": 8,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "gpt-4.1-mini",
        "displayName": "GPT-4.1 Mini",
        "currency": "USD",
        "inputPerMillion": 0.4,
        "outputPerMillion": 1.6,
        "cacheReadPerMillion": 0.1,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "o3",
        "displayName": "o3",
        "currency": "USD",
        "inputPerMillion": 2,
        "outputPerMillion": 8,
        "cacheReadPerMillion": 0.5,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "o4-mini",
        "displayName": "o4-mini",
        "currency": "USD",
        "inputPerMillion": 1.1,
        "outputPerMillion": 4.4,
        "cacheReadPerMillion": 0.275,
        "cacheWritePerMillion": 0,
    },
    # Grok
    {
        "modelId": "grok-4.5",
        "displayName": "Grok 4.5",
        "currency": "USD",
        "inputPerMillion": 2,
        "outputPerMillion": 6,
        "cacheReadPerMillion": 0.3,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-4.3",
        "displayName": "Grok 4.3",
        "currency": "USD",
        "inputPerMillion": 1.25,
        "outputPerMillion": 2.5,
        "cacheReadPerMillion": 0.2,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-4.20-0309-reasoning",
        "displayName": "Grok 4.20 Reasoning",
        "currency": "USD",
        "inputPerMillion": 1.25,
        "outputPerMillion": 2.5,
        "cacheReadPerMillion": 0.2,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-4.20-0309-non-reasoning",
        "displayName": "Grok 4.20",
        "currency": "USD",
        "inputPerMillion": 1.25,
        "outputPerMillion": 2.5,
        "cacheReadPerMillion": 0.2,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-build-0.1",
        "displayName": "Grok Build 0.1",
        "currency": "USD",
        "inputPerMillion": 1,
        "outputPerMillion": 2,
        "cacheReadPerMillion": 0.2,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-4",
        "displayName": "Grok 4",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.75,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-3",
        "displayName": "Grok 3",
        "currency": "USD",
        "inputPerMillion": 3,
        "outputPerMillion": 15,
        "cacheReadPerMillion": 0.75,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "grok-3-mini",
        "displayName": "Grok 3 Mini",
        "currency": "USD",
        "inputPerMillion": 0.3,
        "outputPerMillion": 0.5,
        "cacheReadPerMillion": 0.075,
        "cacheWritePerMillion": 0,
    },
    # GLM
    {
        "modelId": "z-ai/glm-5.2",
        "displayName": "GLM-5.2",
        "currency": "CNY",
        "inputPerMillion": 4,
        "outputPerMillion": 16,
        "cacheReadPerMillion": 0,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "glm-5.2",
        "displayName": "GLM-5.2",
        "currency": "CNY",
        "inputPerMillion": 4,
        "outputPerMillion": 16,
        "cacheReadPerMillion": 0,
        "cacheWritePerMillion": 0,
    },
    {
        "modelId": "glm-4.5",
        "displayName": "GLM-4.5",
        "currency": "CNY",
        "inputPerMillion": 2,
        "outputPerMillion": 8,
        "cacheReadPerMillion": 0,
        "cacheWritePerMillion": 0,
    },
]

DISPLAY_NAME_MAP = {
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "gpt-5.5": "GPT-5.5",
    "grok-4.5": "Grok 4.5",
    "z-ai/glm-5.2": "GLM-5.2",
}


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"database not found: {DB}")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    conn = sqlite3.connect(DB)
    try:
        conn.execute(
            "INSERT INTO app_setting(key, value_json, updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, "
            "updated_at=excluded.updated_at",
            ("model-pricing", json.dumps(PRICING, ensure_ascii=False), now),
        )
        for provider_model_id, display_name in DISPLAY_NAME_MAP.items():
            conn.execute(
                "UPDATE model SET display_name=? "
                "WHERE provider_model_id=? AND "
                "(display_name=? OR display_name=provider_model_id)",
                (display_name, provider_model_id, provider_model_id),
            )
        conn.commit()
        row = conn.execute(
            "SELECT length(value_json), updated_at FROM app_setting WHERE key='model-pricing'"
        ).fetchone()
        print(f"pricing saved entries={len(PRICING)} meta={row}")
        for r in conn.execute(
            "SELECT provider_model_id, display_name FROM model ORDER BY provider_model_id"
        ):
            print(r)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
