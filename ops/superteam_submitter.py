#!/usr/bin/env python3
import json, os, stat, urllib.error, urllib.parse, urllib.request
from pathlib import Path

BASE_URL = "https://superteam.fun"
STATE_DIR = Path(os.getenv("OSA_SUPERTEAM_STATE_DIR", "/var/lib/osa-superteam-agent"))
CREDENTIAL_FILE = Path(os.getenv("OSA_SUPERTEAM_CREDENTIAL_FILE", "/run/credentials/osa-superteam-agent.service/superteam-agent.env"))
ALLOWED_ACCESS = {"AGENT_ALLOWED", "AGENT_ONLY"}


def read_env(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("credential_file_invalid")
    values = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def load_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def validate_manifest(listing: dict, manifest: dict) -> dict:
    if listing.get("agent_access") not in ALLOWED_ACCESS or not listing.get("actionable"):
        raise RuntimeError("listing_not_agent_actionable")
    if listing.get("type") == "project":
        raise RuntimeError("project_requires_human_telegram")
    link = str(manifest.get("link") or "").strip()
    other = str(manifest.get("otherInfo") or "").strip()
    if link:
        parsed = urllib.parse.urlparse(link)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise RuntimeError("invalid_submission_link")
    if not link and not other:
        raise RuntimeError("submission_requires_artifact_or_details")
    answers = manifest.get("eligibilityAnswers") or []
    if not isinstance(answers, list):
        raise RuntimeError("eligibility_answers_invalid")
    for item in answers:
        if not isinstance(item, dict) or not str(item.get("question") or "").strip() or not str(item.get("answer") or "").strip():
            raise RuntimeError("eligibility_answers_invalid")
    ask = manifest.get("ask")
    if str(listing.get("compensation_type") or "").lower() in {"range", "variable"} and ask in (None, ""):
        raise RuntimeError("ask_required")
    return {
        "listingId": str(listing["id"]),
        "link": link,
        "tweet": "",
        "otherInfo": other[:8000],
        "eligibilityAnswers": answers,
        "ask": ask,
        "telegram": "",
    }


def post(api_key: str, endpoint: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE_URL + endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "OSA-Superteam-Submitter/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            value = json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"submit_http_{exc.code}:{body}") from exc
    return value if isinstance(value, dict) else {"result": value}


def main() -> int:
    latest = load_json(STATE_DIR / "latest.json", {}) or {}
    listings = latest.get("listings") or []
    candidates = [x for x in listings if isinstance(x, dict) and x.get("actionable")]
    if not candidates:
        print(json.dumps({"status": "no_actionable_listing", "submitted": False}))
        return 0
    listing = sorted(candidates, key=lambda x: (x.get("score", 0), x.get("reward_amount", 0)), reverse=True)[0]
    listing_id = str(listing.get("id") or "")
    manifest = load_json(STATE_DIR / "prepared" / f"{listing_id}.json")
    if not isinstance(manifest, dict):
        print(json.dumps({"status": "awaiting_verified_artifact", "listing_id": listing_id, "submitted": False}))
        return 0
    submitted = set(load_json(STATE_DIR / "submitted.json", []) or [])
    allow_update = bool(manifest.get("allow_update", False))
    if listing_id in submitted and not allow_update:
        print(json.dumps({"status": "already_submitted_exactly_once", "listing_id": listing_id, "submitted": False}))
        return 0
    payload = validate_manifest(listing, manifest)
    creds = read_env(CREDENTIAL_FILE)
    api_key = creds.get("SUPERTEAM_AGENT_API_KEY")
    if not api_key:
        raise RuntimeError("api_key_missing")
    endpoint = "/api/agents/submissions/update" if listing_id in submitted else "/api/agents/submissions/create"
    result = post(api_key, endpoint, payload)
    submitted.add(listing_id)
    atomic_json(STATE_DIR / "submitted.json", sorted(submitted))
    atomic_json(STATE_DIR / "last_submission.json", {"listing_id": listing_id, "endpoint": endpoint, "result": result})
    print(json.dumps({"status": "submitted", "listing_id": listing_id, "updated": endpoint.endswith("update"), "submitted": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
