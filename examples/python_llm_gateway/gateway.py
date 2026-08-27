"""Small, dependency-free reference gateway for production LLM integrations.

This module is intentionally provider-neutral.  It demonstrates the boundary OSA
uses around remote AI services: validate before sending, bound every attempt,
validate structured output, fail over deterministically, and keep telemetry free
of prompt or credential material.
"""

from __future__ import annotations

import asyncio
import copy
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping, Protocol, Sequence


class GatewayValidationError(ValueError):
    """Raised when application or provider data violates the gateway contract."""


class ProviderError(RuntimeError):
    """Raised by provider adapters for retryable upstream failures."""


class Provider(Protocol):
    """Minimal interface implemented by an OpenAI, Anthropic, or local adapter."""

    name: str

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class GatewayConfig:
    timeout_seconds: float = 8.0
    attempts_per_provider: int = 2
    backoff_seconds: float = 0.05
    max_messages: int = 24
    max_content_chars: int = 12_000
    max_total_tokens: int = 64_000
    max_cost_usd: float | None = None
    allowed_tools: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not 0.001 <= self.timeout_seconds <= 120:
            raise GatewayValidationError("timeout_seconds_out_of_range")
        if not 1 <= self.attempts_per_provider <= 5:
            raise GatewayValidationError("attempts_per_provider_out_of_range")
        if not 0 <= self.backoff_seconds <= 10:
            raise GatewayValidationError("backoff_seconds_out_of_range")
        if not 1 <= self.max_messages <= 200:
            raise GatewayValidationError("max_messages_out_of_range")
        if not 1 <= self.max_content_chars <= 1_000_000:
            raise GatewayValidationError("max_content_chars_out_of_range")
        if not 1 <= self.max_total_tokens <= 10_000_000:
            raise GatewayValidationError("max_total_tokens_out_of_range")
        if self.max_cost_usd is not None and (
            isinstance(self.max_cost_usd, bool)
            or not isinstance(self.max_cost_usd, (int, float))
            or self.max_cost_usd < 0
        ):
            raise GatewayValidationError("max_cost_usd_out_of_range")
        if any(not isinstance(name, str) or not name.strip() for name in self.allowed_tools):
            raise GatewayValidationError("invalid_allowed_tool")
        if len(set(self.allowed_tools)) != len(self.allowed_tools):
            raise GatewayValidationError("duplicate_allowed_tool")


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: Mapping[str, Any]


@dataclass(frozen=True)
class StructuredResponse:
    content: str
    tool_calls: tuple[ToolCall, ...]
    input_tokens: int
    output_tokens: int
    cost_usd: float | None


@dataclass(frozen=True)
class AttemptEvent:
    provider: str
    attempt: int
    outcome: str
    latency_ms: int


@dataclass(frozen=True)
class GatewayResult:
    provider: str
    response: StructuredResponse
    attempts: tuple[AttemptEvent, ...]


class GatewayExhausted(RuntimeError):
    def __init__(self, attempts: Sequence[AttemptEvent]):
        super().__init__("all_providers_exhausted")
        self.attempts = tuple(attempts)


def _bounded_nonnegative_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise GatewayValidationError(f"invalid_{field}")
    return value


def _normalize_request(request: Mapping[str, Any], config: GatewayConfig) -> dict[str, Any]:
    if not isinstance(request, Mapping):
        raise GatewayValidationError("request_must_be_mapping")

    messages = request.get("messages")
    if not isinstance(messages, Sequence) or isinstance(messages, (str, bytes)):
        raise GatewayValidationError("messages_must_be_sequence")
    if not messages or len(messages) > config.max_messages:
        raise GatewayValidationError("messages_count_out_of_range")

    normalized_messages: list[dict[str, str]] = []
    total_chars = 0
    for message in messages:
        if not isinstance(message, Mapping):
            raise GatewayValidationError("message_must_be_mapping")
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant", "tool"}:
            raise GatewayValidationError("invalid_message_role")
        if not isinstance(content, str):
            raise GatewayValidationError("message_content_must_be_string")
        total_chars += len(content)
        if total_chars > config.max_content_chars:
            raise GatewayValidationError("message_content_limit_exceeded")
        normalized_messages.append({"role": role, "content": content})

    tools = request.get("tools", [])
    if not isinstance(tools, Sequence) or isinstance(tools, (str, bytes)):
        raise GatewayValidationError("tools_must_be_sequence")
    normalized_tools: list[dict[str, Any]] = []
    allowed = set(config.allowed_tools)
    for tool in tools:
        if not isinstance(tool, Mapping) or not isinstance(tool.get("name"), str):
            raise GatewayValidationError("invalid_tool_definition")
        name = tool["name"].strip()
        if not name or name not in allowed:
            raise GatewayValidationError("tool_not_allowed")
        schema = tool.get("schema", {})
        if not isinstance(schema, Mapping):
            raise GatewayValidationError("tool_schema_must_be_mapping")
        normalized_tools.append({"name": name, "schema": dict(schema)})

    return {"messages": normalized_messages, "tools": normalized_tools}


def _parse_response(raw: Mapping[str, Any], config: GatewayConfig) -> StructuredResponse:
    if not isinstance(raw, Mapping):
        raise GatewayValidationError("provider_response_must_be_mapping")
    content = raw.get("content", "")
    if not isinstance(content, str):
        raise GatewayValidationError("provider_content_must_be_string")

    raw_calls = raw.get("tool_calls", [])
    if not isinstance(raw_calls, Sequence) or isinstance(raw_calls, (str, bytes)):
        raise GatewayValidationError("provider_tool_calls_must_be_sequence")
    allowed = set(config.allowed_tools)
    tool_calls: list[ToolCall] = []
    for call in raw_calls:
        if not isinstance(call, Mapping):
            raise GatewayValidationError("invalid_provider_tool_call")
        name = call.get("name")
        arguments = call.get("arguments")
        if not isinstance(name, str) or name not in allowed:
            raise GatewayValidationError("provider_tool_not_allowed")
        if not isinstance(arguments, Mapping):
            raise GatewayValidationError("provider_tool_arguments_must_be_mapping")
        tool_calls.append(ToolCall(name=name, arguments=dict(arguments)))
    if not content and not tool_calls:
        raise GatewayValidationError("provider_response_empty")

    usage = raw.get("usage", {})
    if not isinstance(usage, Mapping):
        raise GatewayValidationError("provider_usage_must_be_mapping")
    input_tokens = _bounded_nonnegative_int(usage.get("input_tokens", 0), "input_tokens")
    output_tokens = _bounded_nonnegative_int(usage.get("output_tokens", 0), "output_tokens")
    cost_value = usage.get("cost_usd")
    if cost_value is None:
        cost_usd = None
    elif isinstance(cost_value, bool) or not isinstance(cost_value, (int, float)) or cost_value < 0:
        raise GatewayValidationError("invalid_cost_usd")
    else:
        cost_usd = float(cost_value)
    if input_tokens + output_tokens > config.max_total_tokens:
        raise GatewayValidationError("provider_token_limit_exceeded")
    if config.max_cost_usd is not None:
        if cost_usd is None:
            raise GatewayValidationError("provider_cost_required")
        if cost_usd > config.max_cost_usd:
            raise GatewayValidationError("provider_cost_limit_exceeded")

    return StructuredResponse(
        content=content,
        tool_calls=tuple(tool_calls),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
    )


class ConversationMemory:
    """Bounded in-memory context; a production adapter can persist snapshots."""

    def __init__(self, max_messages: int = 12, max_chars: int = 8_000):
        if max_messages < 1 or max_chars < 1:
            raise GatewayValidationError("invalid_memory_bounds")
        self._max_messages = max_messages
        self._max_chars = max_chars
        self._messages: deque[dict[str, str]] = deque()
        self._chars = 0

    def append(self, role: str, content: str) -> None:
        if role not in {"system", "user", "assistant", "tool"} or not isinstance(content, str):
            raise GatewayValidationError("invalid_memory_message")
        if len(content) > self._max_chars:
            raise GatewayValidationError("memory_message_too_large")
        self._messages.append({"role": role, "content": content})
        self._chars += len(content)
        while len(self._messages) > self._max_messages or self._chars > self._max_chars:
            removed = self._messages.popleft()
            self._chars -= len(removed["content"])

    def snapshot(self) -> tuple[Mapping[str, str], ...]:
        return tuple(dict(message) for message in self._messages)


class LLMGateway:
    def __init__(
        self,
        providers: Sequence[Provider],
        config: GatewayConfig | None = None,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.perf_counter,
    ):
        if not providers:
            raise GatewayValidationError("at_least_one_provider_required")
        if len(providers) > 8:
            raise GatewayValidationError("provider_count_out_of_range")
        names = [provider.name for provider in providers]
        if any(not isinstance(name, str) or not name.strip() for name in names):
            raise GatewayValidationError("provider_name_required")
        if len(set(names)) != len(names):
            raise GatewayValidationError("duplicate_provider_name")
        self._providers = tuple(providers)
        self._config = config or GatewayConfig()
        self._sleep = sleep
        self._clock = clock

    async def complete(self, request: Mapping[str, Any]) -> GatewayResult:
        normalized = _normalize_request(request, self._config)
        events: list[AttemptEvent] = []

        for provider in self._providers:
            for attempt in range(1, self._config.attempts_per_provider + 1):
                started = self._clock()
                try:
                    raw = await asyncio.wait_for(
                        provider.complete(copy.deepcopy(normalized)),
                        timeout=self._config.timeout_seconds,
                    )
                    response = _parse_response(raw, self._config)
                except TimeoutError:
                    outcome = "timeout"
                except GatewayValidationError:
                    outcome = "invalid_response"
                except ProviderError:
                    outcome = "provider_error"
                except Exception:
                    outcome = "provider_error"
                else:
                    events.append(
                        AttemptEvent(
                            provider=provider.name,
                            attempt=attempt,
                            outcome="ok",
                            latency_ms=max(0, round((self._clock() - started) * 1000)),
                        )
                    )
                    return GatewayResult(provider=provider.name, response=response, attempts=tuple(events))

                events.append(
                    AttemptEvent(
                        provider=provider.name,
                        attempt=attempt,
                        outcome=outcome,
                        latency_ms=max(0, round((self._clock() - started) * 1000)),
                    )
                )
                if attempt < self._config.attempts_per_provider and self._config.backoff_seconds:
                    await self._sleep(self._config.backoff_seconds * (2 ** (attempt - 1)))

        raise GatewayExhausted(events)
