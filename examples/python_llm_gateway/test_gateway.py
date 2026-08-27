from __future__ import annotations

import asyncio
import unittest
from collections import deque
from typing import Any, Mapping

from gateway import (
    ConversationMemory,
    GatewayConfig,
    GatewayExhausted,
    GatewayValidationError,
    LLMGateway,
    ProviderError,
)


class ScriptedProvider:
    def __init__(self, name: str, outcomes: list[Any]):
        self.name = name
        self.outcomes = deque(outcomes)
        self.calls: list[Mapping[str, Any]] = []

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.calls.append(request)
        outcome = self.outcomes.popleft()
        if isinstance(outcome, BaseException):
            raise outcome
        if callable(outcome):
            return await outcome()
        return outcome


class MutatingProvider:
    name = "mutating"

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        request["messages"][0]["content"] = "tampered"
        raise ProviderError("upstream")


class InspectingProvider:
    name = "inspecting"

    def __init__(self) -> None:
        self.seen_content: str | None = None

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.seen_content = request["messages"][0]["content"]
        return valid_response("safe")


def valid_response(content: str = "ok") -> dict[str, Any]:
    return {
        "content": content,
        "tool_calls": [],
        "usage": {"input_tokens": 12, "output_tokens": 4, "cost_usd": 0.001},
    }


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_primary_provider_returns_structured_result(self) -> None:
        primary = ScriptedProvider("primary", [valid_response("answer")])
        gateway = LLMGateway([primary], GatewayConfig(attempts_per_provider=1))

        result = await gateway.complete({"messages": [{"role": "user", "content": "secret prompt"}]})

        self.assertEqual(result.provider, "primary")
        self.assertEqual(result.response.content, "answer")
        self.assertEqual(result.response.input_tokens, 12)
        self.assertEqual(result.attempts[0].outcome, "ok")
        self.assertNotIn("secret prompt", repr(result.attempts))

    async def test_retry_then_success_uses_bounded_backoff(self) -> None:
        primary = ScriptedProvider("primary", [ProviderError("upstream"), valid_response()])
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        gateway = LLMGateway(
            [primary],
            GatewayConfig(attempts_per_provider=2, backoff_seconds=0.25),
            sleep=fake_sleep,
        )
        result = await gateway.complete({"messages": [{"role": "user", "content": "hello"}]})

        self.assertEqual([event.outcome for event in result.attempts], ["provider_error", "ok"])
        self.assertEqual(sleeps, [0.25])

    async def test_invalid_tool_call_falls_back_to_second_provider(self) -> None:
        invalid = {
            "content": "",
            "tool_calls": [{"name": "delete_everything", "arguments": {}}],
            "usage": {},
        }
        primary = ScriptedProvider("primary", [invalid])
        fallback = ScriptedProvider("fallback", [valid_response("safe")])
        gateway = LLMGateway(
            [primary, fallback],
            GatewayConfig(attempts_per_provider=1, allowed_tools=("lookup",)),
        )

        result = await gateway.complete(
            {
                "messages": [{"role": "user", "content": "use a tool"}],
                "tools": [{"name": "lookup", "schema": {"type": "object"}}],
            }
        )

        self.assertEqual(result.provider, "fallback")
        self.assertEqual([event.outcome for event in result.attempts], ["invalid_response", "ok"])

    async def test_timeout_falls_back_without_hanging(self) -> None:
        async def slow() -> Mapping[str, Any]:
            await asyncio.sleep(0.1)
            return valid_response()

        primary = ScriptedProvider("slow", [slow])
        fallback = ScriptedProvider("fallback", [valid_response("fast")])
        gateway = LLMGateway(
            [primary, fallback],
            GatewayConfig(timeout_seconds=0.01, attempts_per_provider=1),
        )

        result = await gateway.complete({"messages": [{"role": "user", "content": "hello"}]})

        self.assertEqual(result.provider, "fallback")
        self.assertEqual(result.attempts[0].outcome, "timeout")

    async def test_application_input_is_rejected_before_provider_call(self) -> None:
        provider = ScriptedProvider("primary", [valid_response()])
        gateway = LLMGateway([provider], GatewayConfig(allowed_tools=("lookup",)))

        with self.assertRaisesRegex(GatewayValidationError, "tool_not_allowed"):
            await gateway.complete(
                {
                    "messages": [{"role": "user", "content": "hello"}],
                    "tools": [{"name": "shell", "schema": {}}],
                }
            )

        self.assertEqual(provider.calls, [])

    async def test_exhaustion_exposes_codes_not_provider_messages(self) -> None:
        provider = ScriptedProvider("primary", [ProviderError("credential=do-not-log")])
        gateway = LLMGateway([provider], GatewayConfig(attempts_per_provider=1))

        with self.assertRaises(GatewayExhausted) as caught:
            await gateway.complete({"messages": [{"role": "user", "content": "hello"}]})

        self.assertEqual(caught.exception.attempts[0].outcome, "provider_error")
        self.assertNotIn("credential", repr(caught.exception.attempts))

    async def test_cost_limit_rejects_primary_and_uses_fallback(self) -> None:
        expensive = valid_response("expensive")
        expensive["usage"]["cost_usd"] = 0.5
        primary = ScriptedProvider("primary", [expensive])
        fallback = ScriptedProvider("fallback", [valid_response("within budget")])
        gateway = LLMGateway(
            [primary, fallback],
            GatewayConfig(attempts_per_provider=1, max_cost_usd=0.01),
        )

        result = await gateway.complete({"messages": [{"role": "user", "content": "hello"}]})

        self.assertEqual(result.provider, "fallback")
        self.assertEqual([event.outcome for event in result.attempts], ["invalid_response", "ok"])

    async def test_provider_mutation_isolated_from_fallback(self) -> None:
        fallback = InspectingProvider()
        gateway = LLMGateway(
            [MutatingProvider(), fallback],
            GatewayConfig(attempts_per_provider=1),
        )

        result = await gateway.complete({"messages": [{"role": "user", "content": "original"}]})

        self.assertEqual(result.provider, "inspecting")
        self.assertEqual(fallback.seen_content, "original")


class MemoryTests(unittest.TestCase):
    def test_memory_evicts_oldest_messages_by_count_and_size(self) -> None:
        memory = ConversationMemory(max_messages=2, max_chars=8)
        memory.append("user", "1234")
        memory.append("assistant", "56")
        memory.append("user", "789")

        self.assertEqual(memory.snapshot(), ({"role": "assistant", "content": "56"}, {"role": "user", "content": "789"}))

    def test_memory_rejects_single_oversized_message(self) -> None:
        memory = ConversationMemory(max_chars=3)
        with self.assertRaisesRegex(GatewayValidationError, "memory_message_too_large"):
            memory.append("user", "1234")


if __name__ == "__main__":
    unittest.main()
