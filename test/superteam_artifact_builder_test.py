import importlib.util
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "ops" / "superteam_artifact_builder.py"
spec = importlib.util.spec_from_file_location("builder", MODULE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def base_listing():
    return {"id": "1", "actionable": True, "type": "bounty"}


def test_text_only_allowed():
    ok, reason = builder.autonomous_text_only(base_listing(), {"deliverables": "Write a concise summary of the supplied material."})
    assert ok is True
    assert reason == "text_only_supported"


def test_external_artifact_rejected():
    ok, reason = builder.autonomous_text_only(base_listing(), {"deliverables": "Open a GitHub pull request with the implementation."})
    assert ok is False
    assert reason == "external_artifact_required"


def test_money_gate_rejected():
    ok, reason = builder.autonomous_text_only(base_listing(), {"requirements": "Deposit USDC before starting."})
    assert ok is False
    assert reason == "money_or_identity_gate"


def test_eligibility_questions_rejected():
    ok, reason = builder.autonomous_text_only(base_listing(), {"eligibilityQuestions": [{"question": "Where do you live?"}]})
    assert ok is False
    assert reason == "eligibility_answers_require_verified_source"


def test_project_rejected():
    listing = base_listing()
    listing["type"] = "project"
    ok, reason = builder.autonomous_text_only(listing, {"deliverables": "Write text"})
    assert ok is False
    assert reason == "project_requires_human_channel"


def test_unverified_external_claim_rejected():
    body = {"ok": True, "text": "We deployed the completed service successfully and everything is now live.", "grounding_unsupported": []}
    try:
        builder.verify_output(body)
    except RuntimeError as exc:
        assert str(exc) == "unverified_external_action_claim"
    else:
        raise AssertionError("expected external action claim to be rejected")
