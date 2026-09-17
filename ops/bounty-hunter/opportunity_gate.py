#!/usr/bin/env python3
"""Evidence-first gate for paid OSS opportunities.

This module is deliberately read-only. It does not claim bounties, post comments,
submit pull requests, or move money. Its job is to reject obvious traps and stale
noise before OSA spends compute or a human spends review time.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROMPT_EXFIL_PATTERNS = (
    r"system prompt",
    r"developer message",
    r"pre[- ]?session instructions",
    r"pre[- ]?conversation instructions",
    r"startup instructions",
    r"runtime instructions",
    r"platform[-_ ]?config",
    r"boot_context",
    r"initial_directives",
    r"paste.{0,80}(?:instructions|context|configuration).{0,40}verbatim",
    r"complete.{0,60}(?:instructions|context|configuration).{0,30}(?:session|runtime|platform)",
)

ENGAGEMENT_PATTERNS = (
    r"star the repository",
    r"must star",
    r"follow (?:the )?repository",
    r"like (?:the )?repository",
)

UPFRONT_COST_PATTERNS = (
    r"entry[ /-]?claim bond",
    r"claim bond",
    r"post.{0,40}(?:bond|deposit).{0,20}(?:usdc|usd|token|coin)",
    r"upfront (?:payment|fee|deposit)",
    r"application fee",
)

UNAVAILABLE_PATTERNS = (
    r"current work state:\s*`?(?:unavailable|expired)",
    r"verification[-_ ]unavailable",
    r"funding[-_ ]pending",
    r"not real compensation",
    r"synthetic.{0,30}(?:bounty|canary|reward)",
    r"honeypot",
)

MIRROR_REPO_MARKERS = (
    "bounty-plaza",
    "bountyscout",
    "bounty-scout",
)

REWARDED_LABELS = {
    "rewarded",
    "💰 rewarded",
    "paid",
    "completed",
}

ALGORA_MARKERS = (
    "algora",
    "algora-pbc[bot]",
    "console.algora.io",
)


@dataclass(frozen=True)
class GateDecision:
    decision: str
    reason: str
    score: int
    manual_only: bool


def _text(candidate: dict[str, Any]) -> str:
    labels = candidate.get("labels") or []
    label_text = " ".join(
        str(item.get("name", "")) if isinstance(item, dict) else str(item)
        for item in labels
    )
    metadata = candidate.get("metadata") or {}
    return "\n".join(
        str(x or "")
        for x in (
            candidate.get("repo"),
            candidate.get("title"),
            candidate.get("body"),
            candidate.get("source"),
            label_text,
            json.dumps(metadata, sort_keys=True, default=str),
        )
    ).lower()


def _labels(candidate: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for item in candidate.get("labels") or []:
        if isinstance(item, dict):
            value = item.get("name")
        else:
            value = item
        if value:
            result.add(str(value).strip().lower())
    return result


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _matches(patterns: Iterable[str], text: str) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL) for pattern in patterns)


def evaluate_candidate(
    candidate: dict[str, Any],
    *,
    min_reward_usd: float = 20.0,
    max_comments: int = 8,
    max_age_days: int = 45,
    now: datetime | None = None,
) -> GateDecision:
    text = _text(candidate)
    labels = _labels(candidate)
    repo = str(candidate.get("repo") or "").lower()
    state = str(candidate.get("state") or "open").lower()
    reward = float(candidate.get("reward_usd") or 0.0)
    comments = int(candidate.get("comments") or 0)
    archived = bool(candidate.get("archived") or (candidate.get("metadata") or {}).get("archived"))

    if state not in {"open", ""}:
        return GateDecision("reject", "issue is not open", 0, False)
    if archived:
        return GateDecision("reject", "repository is archived", 0, False)
    if labels & REWARDED_LABELS:
        return GateDecision("reject", "reward already marked paid/rewarded/completed", 0, False)
    if _matches(PROMPT_EXFIL_PATTERNS, text):
        return GateDecision("reject", "requests hidden prompt/runtime disclosure", 0, False)
    if _matches(ENGAGEMENT_PATTERNS, text):
        return GateDecision("reject", "requires artificial engagement", 0, False)
    if _matches(UPFRONT_COST_PATTERNS, text):
        return GateDecision("reject", "requires an upfront fee/bond/deposit", 0, False)
    if _matches(UNAVAILABLE_PATTERNS, text):
        return GateDecision("reject", "work/funding/verification is unavailable or synthetic", 0, False)
    if any(marker in repo for marker in MIRROR_REPO_MARKERS):
        return GateDecision("reject", "mirror/aggregator repo is not the canonical work source", 0, False)
    if len(re.findall(r"\[bounty\]", str(candidate.get("title") or ""), flags=re.IGNORECASE)) >= 2:
        return GateDecision("reject", "duplicated bounty mirror title", 0, False)
    if reward < min_reward_usd:
        return GateDecision("reject", f"reward below ${min_reward_usd:g} floor", 0, False)
    if comments > max_comments:
        return GateDecision("reject", f"crowded thread ({comments} comments > {max_comments})", 0, False)

    current = now or datetime.now(timezone.utc)
    updated = _parse_time(candidate.get("updated_at"))
    age_days: float | None = None
    if updated is not None:
        age_days = max(0.0, (current - updated).total_seconds() / 86400.0)
        if age_days > max_age_days:
            return GateDecision("reject", f"stale candidate ({age_days:.0f} days since update)", 0, False)

    manual_only = any(marker in text for marker in ALGORA_MARKERS)
    score = 70
    score += min(18, int(reward / 25.0))
    score -= min(28, comments * 4)
    if age_days is not None:
        score -= min(18, int(age_days / 3.0))
    if manual_only:
        score -= 5
    score = max(0, min(100, score))

    reason = "passes evidence-first gate"
    if manual_only:
        reason += "; Algora interaction must remain manual"
    return GateDecision("keep", reason, score, manual_only)


def gate_candidates(candidates: Iterable[dict[str, Any]], **kwargs: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for candidate in candidates:
        decision = evaluate_candidate(candidate, **kwargs)
        output.append({**candidate, "gate": asdict(decision)})
    return sorted(output, key=lambda item: int(item["gate"]["score"]), reverse=True)


def _load_candidates(path: str) -> list[dict[str, Any]]:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if isinstance(payload, dict):
        payload = payload.get("candidates", payload.get("items", []))
    if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
        raise ValueError("input must be a JSON array of candidate objects")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Filter bounty candidates before OSA spends compute")
    parser.add_argument("input", nargs="?", default="-", help="JSON file or - for stdin")
    parser.add_argument("--min-reward", type=float, default=20.0)
    parser.add_argument("--max-comments", type=int, default=8)
    parser.add_argument("--max-age-days", type=int, default=45)
    parser.add_argument("--kept-only", action="store_true")
    args = parser.parse_args()

    rows = gate_candidates(
        _load_candidates(args.input),
        min_reward_usd=args.min_reward,
        max_comments=args.max_comments,
        max_age_days=args.max_age_days,
    )
    if args.kept_only:
        rows = [row for row in rows if row["gate"]["decision"] == "keep"]
    print(json.dumps(rows, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
