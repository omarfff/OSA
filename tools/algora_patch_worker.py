#!/usr/bin/env python3
"""Prepare and sandbox-test a patch for one verified Algora GitHub candidate.

This worker has no GitHub write credential and never pushes, comments, claims,
opens a pull request, accepts terms, or moves money. Repository code is only
executed inside a resource-bounded Docker container.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request


REPORT = Path(os.getenv("OSA_ALGORA_STATUS", "/var/lib/osa-algora-worker/latest.json"))
STATE = Path(os.getenv("OSA_ALGORA_PATCH_STATE", "/var/lib/osa-algora-patches"))
MODEL = os.getenv("OSA_ALGORA_CODER_MODEL", "qwen2.5-coder:1.5b")
OLLAMA = os.getenv("OSA_OLLAMA_URL", "http://127.0.0.1:11434")
SUPPORTED = {"javascript", "typescript"}
MAX_CONTEXT = 80_000
MAX_DIFF = 100_000


class PatchError(RuntimeError):
    pass


def candidate_key(candidate: dict) -> str:
    repo = str(candidate.get("repository") or "")
    number = int(candidate.get("issue_number") or 0)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or number < 1:
        raise PatchError("invalid_candidate_identity")
    return repo.replace("/", "__") + f"__{number}"


def select_candidate(report: dict) -> dict | None:
    if report.get("source_of_truth") != "GitHub API" or report.get("algora_scraping") is not False:
        raise PatchError("untrusted_discovery_report")
    for candidate in report.get("candidates") or []:
        if candidate.get("eligible") and str(candidate.get("language") or "").lower() in SUPPORTED:
            candidate_key(candidate)
            return candidate
    return None


def github_json(url: str) -> dict:
    if not re.fullmatch(r"https://api\.github\.com/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/\d+", url):
        raise PatchError("invalid_github_issue_api_url")
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "OSA-Algora-Patch-Worker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def useful_files(repo: Path, issue_text: str) -> list[tuple[str, str]]:
    tokens = {x.lower() for x in re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", issue_text)}
    rows: list[tuple[int, str, str]] = []
    paths = subprocess.run(["git", "ls-files"], cwd=repo, check=True, capture_output=True, text=True).stdout.splitlines()
    allowed = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".md"}
    for raw in paths:
        path = Path(raw)
        if path.is_absolute() or ".." in path.parts or path.suffix.lower() not in allowed:
            continue
        if any(x in path.parts for x in ("node_modules", "dist", "build", "coverage", ".git")):
            continue
        full = repo / path
        if not full.is_file() or full.is_symlink() or full.stat().st_size > 24_000:
            continue
        try:
            text = full.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        name = raw.lower()
        score = sum(4 for token in tokens if token in name)
        if raw in {"package.json", "README.md", "CONTRIBUTING.md"}:
            score += 5
        if any(part in name for part in ("test", "spec", "src/")):
            score += 2
        rows.append((score, raw, text))
    rows.sort(key=lambda x: (x[0], -len(x[2])), reverse=True)
    chosen, total = [], 0
    for _, path, text in rows:
        if len(chosen) >= 12 or total + len(text) > MAX_CONTEXT:
            continue
        chosen.append((path, text)); total += len(text)
    return chosen


def ask_model(candidate: dict, issue: dict, files: list[tuple[str, str]]) -> str:
    context = "\n\n".join(f"FILE: {path}\n{text}" for path, text in files)
    prompt = f"""You are preparing a minimal patch for a public GitHub issue.
Return ONLY a valid unified diff accepted by git apply. No markdown fences.
Do not add dependencies, workflows, credentials, network calls, telemetry, generated files, or unrelated refactors.
Repository: {candidate['repository']}
Issue #{candidate['issue_number']}: {issue.get('title','')}
Issue body:\n{str(issue.get('body') or '')[:9000]}
Repository context:\n{context}
"""
    payload = json.dumps({"model": MODEL, "prompt": prompt, "stream": False,
                          "options": {"temperature": 0, "num_predict": 1800}}).encode()
    req = urllib.request.Request(OLLAMA.rstrip("/") + "/api/generate", data=payload,
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=240) as response:
        result = json.load(response)
    return str(result.get("response") or "")


def clean_diff(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:diff)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    if len(text) > MAX_DIFF or not text.startswith("diff --git "):
        raise PatchError("invalid_or_oversized_diff")
    paths = re.findall(r"^diff --git a/(.+?) b/(.+?)$", text, re.MULTILINE)
    if not paths or len(paths) > 6:
        raise PatchError("invalid_diff_file_count")
    for left, right in paths:
        for raw in (left, right):
            path = Path(raw)
            if path.is_absolute() or ".." in path.parts or raw.startswith(".github/workflows/"):
                raise PatchError("unsafe_diff_path")
        if left != right:
            raise PatchError("renames_not_allowed")
    return text + "\n"


def docker_node_test(repo: Path) -> tuple[bool, str]:
    package = repo / "package.json"
    if not package.is_file():
        return False, "package_json_missing"
    scripts = json.loads(package.read_text()).get("scripts") or {}
    if not scripts.get("test"):
        return False, "test_script_missing"
    base = ["docker", "run", "--rm", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--pids-limit=128", "--memory=1g", "--cpus=.75", "-v", f"{repo}:/work", "-w", "/work",
            "node:20-alpine"]
    install = subprocess.run(base[:2] + ["--network=bridge"] + base[2:] +
                             ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                             capture_output=True, text=True, timeout=300)
    if install.returncode:
        return False, (install.stdout + install.stderr)[-5000:]
    test = subprocess.run(base[:2] + ["--network=none"] + base[2:] + ["npm", "test"],
                          capture_output=True, text=True, timeout=300)
    return test.returncode == 0, (test.stdout + test.stderr)[-8000:]


def run() -> dict:
    report = json.loads(REPORT.read_text())
    candidate = select_candidate(report)
    result = {"status": "no_eligible_supported_candidate", "pr_submitted": False,
              "payout_received": False, "candidate": None}
    if candidate is None:
        return result
    key = candidate_key(candidate); result["candidate"] = key
    out = STATE / key; out.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = out / "result.json"
    if marker.exists():
        return json.loads(marker.read_text())
    repo_name, number = candidate["repository"], int(candidate["issue_number"])
    issue = github_json(f"https://api.github.com/repos/{repo_name}/issues/{number}")
    with tempfile.TemporaryDirectory(prefix="osa-algora-patch-") as tmp:
        repo = Path(tmp, "repo")
        subprocess.run(["git", "clone", "--depth=1", "--", f"https://github.com/{repo_name}.git", str(repo)],
                       check=True, timeout=180, capture_output=True, text=True)
        diff = clean_diff(ask_model(candidate, issue, useful_files(repo, str(issue.get("title", "")) + "\n" + str(issue.get("body", "")))))
        patch_path = Path(tmp, "change.patch"); patch_path.write_text(diff)
        subprocess.run(["git", "apply", "--check", str(patch_path)], cwd=repo, check=True,
                       timeout=30, capture_output=True, text=True)
        subprocess.run(["git", "apply", str(patch_path)], cwd=repo, check=True, timeout=30)
        passed, logs = docker_node_test(repo)
        (out / "change.patch").write_text(diff)
        os.chmod(out / "change.patch", 0o600)
        result.update({"status": "ready_for_submission_gate" if passed else "sandbox_test_failed",
                       "sandbox_tests_passed": passed, "test_log_tail": logs,
                       "pr_submitted": False, "payout_received": False})
    marker.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n"); os.chmod(marker, 0o600)
    return result


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
