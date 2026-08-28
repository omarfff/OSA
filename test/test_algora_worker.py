import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest

from tools.algora_worker import (
    Candidate,
    Policy,
    WorkerError,
    build_candidate,
    extract_amount_usd,
    parse_algora_signal,
    run_once,
    score_candidate,
    validate_brain_url,
)


NOW = dt.datetime(2026, 8, 27, 12, 0, tzinfo=dt.timezone.utc)


def bot_comment(body, *, updated="2026-08-27T10:00:00Z"):
    return {
        "id": 1,
        "user": {"login": "algora-pbc[bot]"},
        "body": body,
        "html_url": "https://github.com/acme/tool/issues/7#issuecomment-1",
        "created_at": updated,
        "updated_at": updated,
    }


def issue(**overrides):
    value = {
        "number": 7,
        "html_url": "https://github.com/acme/tool/issues/7",
        "url": "https://api.github.com/repos/acme/tool/issues/7",
        "repository_url": "https://api.github.com/repos/acme/tool",
        "comments_url": "https://api.github.com/repos/acme/tool/issues/7/comments",
        "title": "Add regression test for parser validation",
        "body": "Add a focused regression test and clearer validation error.",
        "state": "open",
        "comments": 2,
        "updated_at": "2026-08-27T10:00:00Z",
    }
    value.update(overrides)
    return value


def repo(**overrides):
    value = {
        "language": "Python",
        "stargazers_count": 500,
        "archived": False,
        "disabled": False,
        "fork": False,
    }
    value.update(overrides)
    return value


def valid_template(amount="$250"):
    return f"""## 💎 {amount} bounty

1. Submit work: Create a pull request including `/claim #7` in the PR body
2. Receive payment: 100% is received 2-5 days post-reward.

[Algora](https://algora.io/acme/tool/issues/7)

- To claim a bounty, provide a short demo video in your pull request.
"""


class AmountTests(unittest.TestCase):
    def test_extracts_standard_amount(self):
        self.assertEqual(extract_amount_usd("## 💎 $1,250.50 bounty"), 1250.50)

    def test_rejects_unrelated_dollars(self):
        self.assertIsNone(extract_amount_usd("Budget $999 but this is not a bounty template"))


class SignalTests(unittest.TestCase):
    def test_verifies_bot_template_and_counts_unique_attempts(self):
        comments = [
            bot_comment(valid_template()),
            {"user": {"login": "alice"}, "body": "/attempt #7"},
            {"user": {"login": "alice"}, "body": "/attempt #7 again"},
            {"user": {"login": "bob"}, "body": "/claim #7"},
        ]
        signal = parse_algora_signal(comments, 7)
        self.assertTrue(signal.verified)
        self.assertEqual(signal.amount_usd, 250)
        self.assertEqual(signal.attempts, 1)
        self.assertEqual(signal.claim_mentions, 1)
        self.assertTrue(signal.demo_required)
        self.assertEqual(signal.payout_window, "2-5 days")

    def test_rejects_non_bot_template(self):
        signal = parse_algora_signal(
            [{"user": {"login": "attacker"}, "body": valid_template("$5000")}], 7
        )
        self.assertFalse(signal.verified)
        self.assertIsNone(signal.amount_usd)

    def test_rejects_cancelled_template(self):
        signal = parse_algora_signal(
            [bot_comment(valid_template() + "\nThis bounty was cancelled.")], 7
        )
        self.assertFalse(signal.verified)
        self.assertIn("bounty_cancelled", signal.reasons)


class PolicyTests(unittest.TestCase):
    def candidate(self, **overrides):
        value = Candidate(
            issue_url="https://github.com/acme/tool/issues/7",
            api_url="https://api.github.com/repos/acme/tool/issues/7",
            repository="acme/tool",
            issue_number=7,
            title="Add regression test for parser validation",
            body="Small test-only fix.",
            state="open",
            comments_count=5,
            updated_at="2026-08-27T10:00:00Z",
            amount_usd=250,
            attempts=1,
            claim_mentions=0,
            demo_required=True,
            payout_window="2-5 days",
            bot_comment_url="https://github.com/acme/tool/issues/7#issuecomment-1",
            language="Python",
            stars=500,
            archived=False,
            disabled=False,
            is_fork=False,
        )
        for key, val in overrides.items():
            setattr(value, key, val)
        return value

    def test_eligible_candidate_keeps_demo_as_submission_gate(self):
        candidate = score_candidate(self.candidate(), Policy(), NOW)
        self.assertTrue(candidate.eligible)
        self.assertIn("demo_video_required_before_submission", candidate.reasons)
        self.assertGreater(candidate.score, 0)

    def test_closed_github_issue_is_never_eligible(self):
        candidate = score_candidate(self.candidate(state="closed"), Policy(), NOW)
        self.assertFalse(candidate.eligible)
        self.assertIn("github_issue_not_open", candidate.reasons)

    def test_stale_crowded_or_low_value_is_rejected(self):
        candidate = score_candidate(
            self.candidate(
                updated_at="2025-01-01T00:00:00Z",
                comments_count=200,
                attempts=20,
                amount_usd=20,
            ),
            Policy(),
            NOW,
        )
        self.assertFalse(candidate.eligible)
        self.assertIn("issue_stale", candidate.reasons)
        self.assertIn("too_many_comments", candidate.reasons)
        self.assertIn("too_many_attempts", candidate.reasons)
        self.assertIn("amount_below_minimum", candidate.reasons)

    def test_sensitive_scope_is_rejected(self):
        candidate = score_candidate(
            self.candidate(title="Fix OAuth token transfer wallet flow"), Policy(), NOW
        )
        self.assertFalse(candidate.eligible)
        self.assertTrue(any(reason.startswith("risk_terms:") for reason in candidate.reasons))


class ConstructionTests(unittest.TestCase):
    def test_builds_candidate_only_from_bot_signal(self):
        candidate = build_candidate(issue(), [bot_comment(valid_template())], repo())
        self.assertEqual(candidate.repository, "acme/tool")
        self.assertEqual(candidate.amount_usd, 250)
        self.assertEqual(candidate.language, "Python")

    def test_brain_must_be_loopback_http(self):
        self.assertEqual(validate_brain_url("http://127.0.0.1:8787"), "http://127.0.0.1:8787")
        for value in ("https://127.0.0.1:8787", "http://example.com", "http://user:pass@localhost:8787"):
            with self.assertRaises(WorkerError):
                validate_brain_url(value)


class FakeClient:
    def __init__(self, rows):
        self.rows = rows

    def search(self, query, limit):
        return self.rows[:limit]

    def comments(self, row):
        return [bot_comment(valid_template())]

    def repository(self, full_name):
        return repo()


class RunTests(unittest.TestCase):
    def test_run_writes_truthful_report_and_never_claims_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = run_once(
                FakeClient([issue()]),
                Policy(),
                state_dir=tmp,
                use_brain=False,
                now=NOW,
            )
            self.assertEqual(report["totals"]["inspected"], 1)
            self.assertEqual(report["totals"]["eligible"], 1)
            self.assertFalse(report["algora_scraping"])
            self.assertFalse(report["execution"]["code_changed"])
            self.assertFalse(report["execution"]["pull_request_submitted"])
            self.assertFalse(report["execution"]["payout_received"])
            saved = json.loads(Path(tmp, "latest.json").read_text())
            self.assertEqual(saved["source_of_truth"], "GitHub API")
            self.assertEqual(Path(tmp, "latest.json").stat().st_mode & 0o777, 0o640)
            self.assertTrue(Path(tmp, "runs.jsonl").read_text().strip())

    def test_unverified_signal_stays_ineligible(self):
        class MissingBot(FakeClient):
            def comments(self, row):
                return []

        with tempfile.TemporaryDirectory() as tmp:
            report = run_once(
                MissingBot([issue(comments=0)]),
                Policy(),
                state_dir=tmp,
                use_brain=False,
                now=NOW,
            )
            self.assertEqual(report["totals"]["eligible"], 0)
            self.assertIn("algora_bot_comment_missing", report["candidates"][0]["reasons"])


if __name__ == "__main__":
    unittest.main()
