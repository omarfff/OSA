import datetime as dt
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.parse

from tools.superteam_agent_worker import (
    AgentCredential,
    Policy,
    WorkerError,
    build_live_url,
    load_credential,
    normalize_listing,
    run_once,
    sanitize_details,
)


NOW = dt.datetime(2026, 8, 29, 12, 34, 56, 789000, tzinfo=dt.timezone.utc)


def listing(**overrides):
    value = {
        "id": "listing-1",
        "slug": "agent-bounty",
        "title": "Build a bounded testable tool",
        "type": "bounty",
        "agentAccess": "AGENT_ONLY",
        "deadline": "2026-09-05T12:00:00.000Z",
        "status": "OPEN",
        "compensationType": "fixed",
        "rewardAmount": 500,
        "token": "USDC",
    }
    value.update(overrides)
    return value


class URLTests(unittest.TestCase):
    def test_live_url_uses_full_prisma_compatible_iso_timestamp(self):
        url = build_live_url(NOW, take=99)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        self.assertEqual(query["take"], ["20"])
        self.assertEqual(query["deadline"], ["2026-08-29T12:34:56.789Z"])

    def test_rejects_unknown_type(self):
        with self.assertRaises(WorkerError):
            build_live_url(NOW, listing_type="job")


class CredentialTests(unittest.TestCase):
    def test_loads_secret_without_exposing_key_in_public_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "agent.env")
            path.write_text(
                "SUPERTEAM_AGENT_NAME=osa-brain\n"
                "SUPERTEAM_AGENT_ID=id-1\n"
                "SUPERTEAM_AGENT_USERNAME=osa-brain-1\n"
                "SUPERTEAM_AGENT_API_KEY=sk_secret\n",
                encoding="utf-8",
            )
            os.chmod(path, 0o600)
            credential = load_credential(path)
            self.assertEqual(credential.api_key, "sk_secret")
            self.assertNotIn("api_key", credential.public_dict())

    def test_rejects_world_readable_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "agent.env")
            path.write_text("SUPERTEAM_AGENT_API_KEY=sk_secret\n", encoding="utf-8")
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(WorkerError, "permissions_too_open"):
                load_credential(path)


class PolicyTests(unittest.TestCase):
    def test_future_agent_bounty_is_actionable(self):
        result = normalize_listing(listing(), Policy(), NOW)
        self.assertTrue(result["eligible"])
        self.assertTrue(result["actionable"])

    def test_expired_open_listing_is_rejected(self):
        result = normalize_listing(
            listing(deadline="2026-07-01T00:00:00.000Z"), Policy(), NOW
        )
        self.assertFalse(result["eligible"])
        self.assertIn("deadline_expired", result["reasons"])

    def test_human_only_listing_is_rejected(self):
        result = normalize_listing(listing(agentAccess="HUMAN_ONLY"), Policy(), NOW)
        self.assertFalse(result["eligible"])
        self.assertIn("agent_access_not_allowed", result["reasons"])

    def test_non_stable_reward_is_rejected(self):
        result = normalize_listing(listing(token="RANDOM"), Policy(), NOW)
        self.assertFalse(result["eligible"])
        self.assertIn("unsupported_reward_token", result["reasons"])

    def test_project_requires_human_telegram_before_submission(self):
        result = normalize_listing(listing(type="project"), Policy(), NOW)
        self.assertTrue(result["eligible"])
        self.assertFalse(result["actionable"])
        self.assertIn("human_telegram_required_before_submission", result["submission_gates"])

    def test_long_structured_details_are_safely_bounded(self):
        result = sanitize_details({"requirements": {"items": ["x" * 20_000]}})
        self.assertIsInstance(result["requirements"], str)
        self.assertLessEqual(len(result["requirements"]), 12_001)


class FakeClient:
    def __init__(self, rows):
        self.rows = rows

    def list_live(self, now, take, listing_type):
        return build_live_url(now, take, listing_type), self.rows

    def details(self, slug):
        return {"title": "Official title", "description": "Build an original tested artifact."}


class RunTests(unittest.TestCase):
    def test_report_is_truthful_and_contains_no_secret(self):
        credential = AgentCredential("osa-brain", "id-1", "osa-brain-1", "sk_secret")
        with tempfile.TemporaryDirectory() as tmp:
            report = run_once(
                FakeClient([listing(), listing(id="old", deadline="2026-01-01T00:00:00Z")]),
                credential,
                Policy(),
                state_dir=tmp,
                use_brain=False,
                now=NOW,
            )
            self.assertEqual(report["totals"]["returned"], 2)
            self.assertEqual(report["totals"]["eligible"], 1)
            self.assertEqual(report["totals"]["actionable"], 1)
            self.assertFalse(report["execution"]["submission_created"])
            self.assertFalse(report["execution"]["payout_received"])
            encoded = json.dumps(report)
            self.assertNotIn("sk_secret", encoded)
            self.assertEqual(Path(tmp, "latest.json").stat().st_mode & 0o777, 0o640)
            self.assertEqual(Path(tmp, "runs.jsonl").stat().st_mode & 0o777, 0o600)

    def test_seen_state_marks_listing_new_once(self):
        credential = AgentCredential("osa-brain", "id-1", "osa-brain-1", "sk_secret")
        with tempfile.TemporaryDirectory() as tmp:
            first = run_once(
                FakeClient([listing()]), credential, Policy(), state_dir=tmp, use_brain=False, now=NOW
            )
            second = run_once(
                FakeClient([listing()]), credential, Policy(), state_dir=tmp, use_brain=False, now=NOW
            )
            self.assertEqual(first["totals"]["new"], 1)
            self.assertEqual(second["totals"]["new"], 0)


if __name__ == "__main__":
    unittest.main()
