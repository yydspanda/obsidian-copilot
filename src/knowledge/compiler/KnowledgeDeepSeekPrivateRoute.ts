import {
  bindKnowledgePrivateModelRouteToProfile,
  type KnowledgePrivateModelRoute,
  type KnowledgePrivateModelStage,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import {
  encodeKnowledgeCompilerPrompt,
  KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
  KNOWLEDGE_COMPILER_PROMPT_CONTRACT_VERSION,
  type KnowledgeCompilerPromptBehavior,
} from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import type {
  CompilerAnalysisRequest,
  CompilerGenerationRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import { createKnowledgeModelEndpointIdentity } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
  isExactUint8Array,
} from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { SUPPORTED_OKF_VERSION } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Official DeepSeek OpenAI-compatible API origin reviewed for this route. */
export const KNOWLEDGE_DEEPSEEK_API_BASE_URL = "https://api.deepseek.com" as const;

/** Exact non-streaming chat endpoint; redirects and alternate hosts are rejected. */
export const KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT =
  "https://api.deepseek.com/chat/completions" as const;

/** Current DeepSeek transport behavior and resource contract. */
export const KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT = Object.freeze({
  version: 1,
  contextTokens: 1_000_000,
  maxOutputTokens: 384_000,
  promptTokenOverhead: 4_096,
  maxRequestBytes: 8_388_608,
  maxResponseBytes: 8_388_608,
  maxContentBytes: 8_000_000,
});

const SUPPORTED_MODEL_IDENTITIES = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
const SUPPORTED_MODELS = new Set<string>(SUPPORTED_MODEL_IDENTITIES);
const SUPPORTED_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const SUPPORTED_VERBOSITIES = new Set(["low", "medium", "high"]);
const REQUIRED_CONFIGURATION_KEYS = [
  "behaviorContractVersion",
  "routeContractVersion",
  "promptContractIdentity",
  "providerRouteIdentity",
  "adapterPolicy",
  "routingPolicy",
  "structuredOutput",
  "streaming",
  "modelFallback",
  "temperature",
  "maxTokens",
  "reasoningEffort",
  "verbosity",
] as const;
const OPTIONAL_CONFIGURATION_KEYS = ["topP", "endpointIdentity"] as const;
const REFLECT_APPLY = Reflect.apply;

/** Exact reviewed transport behavior identity for pipeline fingerprinting. */
export const KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY = sha256(
  `knowledge-deepseek-private-route-v1\n${canonicalizeJson({
    endpoint: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    models: [...SUPPORTED_MODEL_IDENTITIES],
    limits: KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT,
    requestPolicy: "post-json-object-two-messages-non-streaming-no-tools-no-fallback-no-retry-v1",
    thinkingPolicy: "minimal-disabled-sampling-or-low-medium-high-xhigh-enabled-no-sampling-v1",
    responsePolicy:
      "status-200-exact-url-json-fatal-utf8-one-stop-assistant-no-tools-bounded-usage-v1",
  })}`
);

/** Minimal streamed HTTP response required from a native-fetch-compatible port. */
export interface KnowledgeDeepSeekHttpResponse {
  status: number;
  redirected: boolean;
  url: string;
  headers: Pick<Headers, "get">;
  body: ReadableStream<Uint8Array> | null;
}

/** Narrow HTTP capability injected by the Windows production composer. */
export type KnowledgeDeepSeekFetchPort = (
  url: string,
  init: RequestInit
) => Promise<KnowledgeDeepSeekHttpResponse>;

/** Stable, credential-free DeepSeek transport failure categories. */
export type KnowledgeDeepSeekTransportErrorCode =
  | "dependency_invalid"
  | "profile_invalid"
  | "model_unsupported"
  | "configuration_unsupported"
  | "endpoint_mismatch"
  | "credential_invalid"
  | "request_too_large"
  | "request_rejected"
  | "unauthorized"
  | "insufficient_balance"
  | "rate_limited"
  | "provider_unavailable"
  | "http_failed"
  | "response_too_large"
  | "response_invalid";

/** Sanitized provider failure retaining no URL, prompt, response, key, or cause. */
export class KnowledgeDeepSeekTransportError extends Error {
  /** Creates one stable transport failure. */
  constructor(public readonly code: KnowledgeDeepSeekTransportErrorCode) {
    super("The private DeepSeek knowledge request failed");
    this.name = "KnowledgeDeepSeekTransportError";
  }
}

interface CapturedDeepSeekConfiguration {
  temperature: number;
  maxTokens: number;
  reasoningEffort: KnowledgeCompilerPromptBehavior["reasoningEffort"];
  verbosity: KnowledgeCompilerPromptBehavior["verbosity"];
  topP?: number;
}

interface CapturedDeepSeekProfile {
  profile: KnowledgeBundlePipelineProfile;
  model: string;
  configuration: CapturedDeepSeekConfiguration;
  behavior: KnowledgeCompilerPromptBehavior;
}

interface JsonSnapshotBudget {
  nodes: number;
  characters: number;
}

/** Internal cancellation class used without inspecting arbitrary thrown values. */
class KnowledgeDeepSeekAbortError extends Error {
  /** Creates one sanitized cancellation. */
  constructor() {
    super("The private DeepSeek knowledge request was aborted");
    this.name = "AbortError";
  }
}

/** Creates a sanitized cancellation without retaining an arbitrary abort reason. */
function createAbortError(): Error {
  return new KnowledgeDeepSeekAbortError();
}

/** Compares strings by code unit without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Checks an exact own string-key set without reading property values. */
function hasExactKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const actual = Reflect.ownKeys(value);
    const expected = [...expectedKeys].sort(compareText);
    return (
      actual.length === expected.length &&
      actual.every((key) => typeof key === "string") &&
      actual.sort(compareText).every((key, index) => key === expected[index])
    );
  } catch {
    return false;
  }
}

/** Reads one enumerable own data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Expected an own data property");
  }
  return descriptor.value;
}

/** Reads one optional enumerable own data property without invoking an accessor. */
function readOptionalDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Expected an own data property");
  }
  return descriptor.value;
}

/** Creates one detached JSON snapshot before any asynchronous provider work. */
function snapshotProfile(profile: KnowledgeBundlePipelineProfile): KnowledgeBundlePipelineProfile {
  try {
    return snapshotJsonValue(
      profile,
      { nodes: 0, characters: 0 },
      new Set<object>(),
      0
    ) as unknown as KnowledgeBundlePipelineProfile;
  } catch {
    throw new KnowledgeDeepSeekTransportError("profile_invalid");
  }
}

/** Creates a detached frozen JSON graph without invoking accessors. */
function snapshotJsonValue(
  value: unknown,
  budget: JsonSnapshotBudget,
  ancestors: Set<object>,
  depth: number
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > 50_000 || depth > 32) {
    throw new TypeError("Profile resource limit exceeded");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Expected a finite number");
    return value;
  }
  if (typeof value === "string") {
    budget.characters += value.length;
    if (budget.characters > 2_000_000) {
      throw new TypeError("Profile character limit exceeded");
    }
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Expected acyclic JSON data");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 10_000 ||
        Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
      ) {
        throw new TypeError("Expected a dense bounded array");
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Expected an array data property");
        }
        result.push(snapshotJsonValue(descriptor.value, budget, ancestors, depth + 1));
      }
      return Object.freeze(result) as unknown as JsonValue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Expected a plain object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 1_000 || keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Expected bounded string keys");
    }
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected an object data property");
      }
      budget.characters += key.length;
      if (budget.characters > 2_000_000) {
        throw new TypeError("Profile character limit exceeded");
      }
      Object.defineProperty(result, key, {
        value: snapshotJsonValue(descriptor.value, budget, ancestors, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

/** Validates exact DeepSeek behavior without silently dropping generic settings. */
function captureConfiguration(value: unknown): CapturedDeepSeekConfiguration {
  try {
    const expectedKeys = [...REQUIRED_CONFIGURATION_KEYS, ...OPTIONAL_CONFIGURATION_KEYS].filter(
      (key) => readOptionalDataProperty(value, key) !== undefined
    );
    for (const key of REQUIRED_CONFIGURATION_KEYS) {
      if (readOptionalDataProperty(value, key) === undefined) {
        throw new TypeError("Missing configuration field");
      }
    }
    if (!hasExactKeys(value, expectedKeys)) {
      throw new TypeError("Unsupported configuration field");
    }
    assertKnowledgeConfigurationContainsNoSecrets(value);
    if (
      readDataProperty(value, "behaviorContractVersion") !==
        KNOWLEDGE_COMPILER_PROMPT_CONTRACT_VERSION ||
      readDataProperty(value, "routeContractVersion") !==
        KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.version ||
      readDataProperty(value, "promptContractIdentity") !==
        KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY ||
      readDataProperty(value, "providerRouteIdentity") !==
        KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY ||
      readDataProperty(value, "adapterPolicy") !== "knowledge-projection-only-v1" ||
      readDataProperty(value, "routingPolicy") !== "private-bound-capability-v1" ||
      readDataProperty(value, "structuredOutput") !== "decoded-object-core-schema-v1" ||
      readDataProperty(value, "streaming") !== false ||
      readDataProperty(value, "modelFallback") !== false
    ) {
      throw new TypeError("Unsupported route contract");
    }
    const temperature = readDataProperty(value, "temperature");
    const maxTokens = readDataProperty(value, "maxTokens");
    const reasoningEffort = readDataProperty(value, "reasoningEffort");
    const verbosity = readDataProperty(value, "verbosity");
    const topP = readOptionalDataProperty(value, "topP");
    if (
      typeof temperature !== "number" ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2 ||
      !Number.isSafeInteger(maxTokens) ||
      (maxTokens as number) < 1 ||
      (maxTokens as number) > KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxOutputTokens ||
      typeof reasoningEffort !== "string" ||
      !SUPPORTED_REASONING_EFFORTS.has(reasoningEffort) ||
      typeof verbosity !== "string" ||
      !SUPPORTED_VERBOSITIES.has(verbosity) ||
      (topP !== undefined &&
        (typeof topP !== "number" || !Number.isFinite(topP) || topP < 0 || topP > 1))
    ) {
      throw new TypeError("Unsupported model behavior");
    }
    if (reasoningEffort !== "minimal" && (temperature !== 0 || topP !== undefined)) {
      throw new TypeError("Thinking mode cannot consume sampling behavior");
    }
    const endpointIdentity = readOptionalDataProperty(value, "endpointIdentity");
    const officialIdentity = createKnowledgeModelEndpointIdentity(KNOWLEDGE_DEEPSEEK_API_BASE_URL);
    if (
      endpointIdentity !== undefined &&
      (typeof endpointIdentity !== "string" || endpointIdentity !== officialIdentity)
    ) {
      throw new KnowledgeDeepSeekTransportError("endpoint_mismatch");
    }
    return Object.freeze({
      temperature,
      maxTokens: maxTokens as number,
      reasoningEffort: reasoningEffort as CapturedDeepSeekConfiguration["reasoningEffort"],
      verbosity: verbosity as CapturedDeepSeekConfiguration["verbosity"],
      ...(topP === undefined ? {} : { topP }),
    });
  } catch (error) {
    if (error instanceof KnowledgeDeepSeekTransportError) throw error;
    throw new KnowledgeDeepSeekTransportError("configuration_unsupported");
  }
}

/** Captures a complete profile so non-model prompt behavior remains route-bound. */
function captureProfile(profileValue: KnowledgeBundlePipelineProfile): CapturedDeepSeekProfile {
  const profile = snapshotProfile(profileValue);
  try {
    if (
      !hasExactKeys(profile, [
        "version",
        "bundleId",
        "compiler",
        "parsers",
        "model",
        "outputLanguage",
        "okfVersion",
        "citationContractVersion",
      ]) ||
      readDataProperty(profile, "version") !== 1 ||
      readDataProperty(profile, "okfVersion") !== SUPPORTED_OKF_VERSION ||
      readDataProperty(profile, "citationContractVersion") !== 1
    ) {
      throw new TypeError("Unsupported pipeline contract");
    }
    const outputLanguage = readDataProperty(profile, "outputLanguage");
    const modelProfile = readDataProperty(profile, "model");
    if (!hasExactKeys(modelProfile, ["provider", "model", "configuration"])) {
      throw new TypeError("Unsupported model profile");
    }
    const provider = readDataProperty(modelProfile, "provider");
    const model = readDataProperty(modelProfile, "model");
    if (
      typeof outputLanguage !== "string" ||
      outputLanguage.length === 0 ||
      outputLanguage.length > 1_024 ||
      outputLanguage.trim() !== outputLanguage ||
      provider !== "deepseek" ||
      typeof model !== "string"
    ) {
      throw new TypeError("Unsupported profile");
    }
    if (!SUPPORTED_MODELS.has(model)) {
      throw new KnowledgeDeepSeekTransportError("model_unsupported");
    }
    const configuration = captureConfiguration(readDataProperty(modelProfile, "configuration"));
    return Object.freeze({
      profile,
      model,
      configuration,
      behavior: Object.freeze({
        outputLanguage,
        okfVersion: SUPPORTED_OKF_VERSION,
        citationContractVersion: 1,
        reasoningEffort: configuration.reasoningEffort,
        verbosity: configuration.verbosity,
      }),
    });
  } catch (error) {
    if (error instanceof KnowledgeDeepSeekTransportError) throw error;
    throw new KnowledgeDeepSeekTransportError("profile_invalid");
  }
}

/** Validates a credential without retaining it in an error or public descriptor. */
function captureCredential(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    /\s/.test(value)
  ) {
    throw new KnowledgeDeepSeekTransportError("credential_invalid");
  }
  return value;
}

/** Maps an HTTP status to a stable category without reading the response body. */
function createHttpError(status: number): KnowledgeDeepSeekTransportError {
  if (status === 400 || status === 422) {
    return new KnowledgeDeepSeekTransportError("request_rejected");
  }
  if (status === 401) return new KnowledgeDeepSeekTransportError("unauthorized");
  if (status === 402) return new KnowledgeDeepSeekTransportError("insufficient_balance");
  if (status === 429) return new KnowledgeDeepSeekTransportError("rate_limited");
  if (status === 500 || status === 503) {
    return new KnowledgeDeepSeekTransportError("provider_unavailable");
  }
  return new KnowledgeDeepSeekTransportError("http_failed");
}

/** Starts best-effort reader cancellation without delaying the authoritative failure. */
function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is advisory after the caller's authority has already failed.
  }
}

/** Starts unread-body cancellation without consuming data or delaying a failure. */
function cancelResponseBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // A failed cancellation must not expose provider or native-fetch details.
  }
}

/** Reads a non-streaming API envelope incrementally so bytes are bounded pre-decode. */
async function readBoundedResponseBytes(
  response: KnowledgeDeepSeekHttpResponse,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) throw createAbortError();
  let contentLength: string | null;
  try {
    contentLength = response.headers.get("content-length");
  } catch {
    cancelResponseBody(response.body);
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      cancelResponseBody(response.body);
      throw new KnowledgeDeepSeekTransportError("response_invalid");
    }
    const declared = Number(contentLength);
    if (
      !Number.isSafeInteger(declared) ||
      declared > KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxResponseBytes
    ) {
      cancelResponseBody(response.body);
      throw new KnowledgeDeepSeekTransportError("response_too_large");
    }
  }
  if (!response.body) {
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  const reader = response.body.getReader();
  const abortReader = (): void => {
    void cancelReader(reader);
  };
  signal.addEventListener("abort", abortReader, { once: true });
  const bounded = new Uint8Array(KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxResponseBytes);
  let totalBytes = 0;
  try {
    while (true) {
      if (signal.aborted) {
        cancelReader(reader);
        throw createAbortError();
      }
      const result = await reader.read();
      if (signal.aborted) {
        cancelReader(reader);
        throw createAbortError();
      }
      if (result.done) break;
      if (!isExactUint8Array(result.value)) {
        cancelReader(reader);
        throw new KnowledgeDeepSeekTransportError("response_invalid");
      }
      const nextTotal = totalBytes + result.value.byteLength;
      if (
        !Number.isSafeInteger(nextTotal) ||
        nextTotal > KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxResponseBytes
      ) {
        cancelReader(reader);
        throw new KnowledgeDeepSeekTransportError("response_too_large");
      }
      bounded.set(result.value, totalBytes);
      totalBytes = nextTotal;
    }
  } catch (error) {
    if (signal.aborted) throw createAbortError();
    if (
      error instanceof KnowledgeDeepSeekTransportError ||
      error instanceof KnowledgeDeepSeekAbortError
    ) {
      throw error;
    }
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  } finally {
    signal.removeEventListener("abort", abortReader);
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released or errored; no provider detail escapes.
    }
  }
  return bounded.slice(0, totalBytes);
}

/** Parses only the provider envelope and returns the untouched JSON content string. */
function parseProviderResponse(
  bytes: Uint8Array,
  expectedModel: string,
  maxTokens: number
): string {
  let decoded: string;
  let parsed: unknown;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  try {
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      readDataProperty(parsed, "object") !== "chat.completion" ||
      readDataProperty(parsed, "model") !== expectedModel
    ) {
      throw new TypeError("Unexpected completion envelope");
    }
    const choices = readDataProperty(parsed, "choices");
    if (!Array.isArray(choices) || choices.length !== 1) {
      throw new TypeError("Expected one completion choice");
    }
    const choice = choices[0];
    if (
      readDataProperty(choice, "index") !== 0 ||
      readDataProperty(choice, "finish_reason") !== "stop"
    ) {
      throw new TypeError("Completion did not stop cleanly");
    }
    const message = readDataProperty(choice, "message");
    const content = readDataProperty(message, "content");
    if (
      readDataProperty(message, "role") !== "assistant" ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      throw new TypeError("Expected assistant JSON content");
    }
    const toolCalls = readOptionalDataProperty(message, "tool_calls");
    const functionCall = readOptionalDataProperty(message, "function_call");
    if (
      toolCalls !== undefined &&
      toolCalls !== null &&
      (!Array.isArray(toolCalls) || toolCalls.length !== 0)
    ) {
      throw new TypeError("Unexpected tool call");
    }
    if (functionCall !== undefined && functionCall !== null) {
      throw new TypeError("Unexpected legacy function call");
    }
    const usage = readDataProperty(parsed, "usage");
    const completionTokens = readDataProperty(usage, "completion_tokens");
    const promptTokens = readDataProperty(usage, "prompt_tokens");
    const totalTokens = readDataProperty(usage, "total_tokens");
    if (
      !Number.isSafeInteger(completionTokens) ||
      (completionTokens as number) < 1 ||
      (completionTokens as number) > maxTokens ||
      !Number.isSafeInteger(promptTokens) ||
      (promptTokens as number) < 0 ||
      !Number.isSafeInteger(totalTokens) ||
      (totalTokens as number) !== (promptTokens as number) + (completionTokens as number) ||
      (totalTokens as number) > KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.contextTokens ||
      new TextEncoder().encode(content).byteLength >
        KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxContentBytes
    ) {
      throw new TypeError("Unexpected completion resource usage");
    }
    return content;
  } catch {
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
}

/** Creates the exact DeepSeek request body for one compiler stage. */
function createRequestBody(
  stage: KnowledgePrivateModelStage,
  request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>,
  captured: CapturedDeepSeekProfile
): string {
  const prompt = encodeKnowledgeCompilerPrompt(stage, request, captured.behavior);
  if (
    prompt.promptUtf8Bytes +
      captured.configuration.maxTokens +
      KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.promptTokenOverhead >
    KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.contextTokens
  ) {
    throw new KnowledgeDeepSeekTransportError("request_too_large");
  }
  const thinkingEnabled = captured.configuration.reasoningEffort !== "minimal";
  const reasoningEffort =
    captured.configuration.reasoningEffort === "low"
      ? "low"
      : captured.configuration.reasoningEffort === "xhigh"
        ? "max"
        : "high";
  const body: JsonValue = {
    model: captured.model,
    messages: prompt.messages as unknown as JsonValue,
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: captured.configuration.maxTokens,
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    ...(thinkingEnabled
      ? {
          reasoning_effort: reasoningEffort,
        }
      : {
          temperature: captured.configuration.temperature,
          ...(captured.configuration.topP === undefined
            ? {}
            : { top_p: captured.configuration.topP }),
        }),
  };
  const encoded = canonicalizeJson(body);
  if (
    new TextEncoder().encode(encoded).byteLength >
    KNOWLEDGE_DEEPSEEK_TRANSPORT_CONTRACT.maxRequestBytes
  ) {
    throw new KnowledgeDeepSeekTransportError("request_too_large");
  }
  return encoded;
}

/** Executes one exact POST with no transport-level retry, fallback, or repair. */
async function invokeDeepSeek(
  stage: KnowledgePrivateModelStage,
  request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>,
  signal: AbortSignal,
  captured: CapturedDeepSeekProfile,
  apiKey: string,
  fetchPort: KnowledgeDeepSeekFetchPort
): Promise<string> {
  if (signal.aborted) throw createAbortError();
  const body = createRequestBody(stage, request, captured);
  if (signal.aborted) throw createAbortError();
  const headers = Object.freeze({
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
  const init = Object.freeze({
    method: "POST",
    headers,
    body,
    signal,
    redirect: "error" as const,
    credentials: "omit" as const,
    cache: "no-store" as const,
    referrerPolicy: "no-referrer" as const,
  });
  let response: KnowledgeDeepSeekHttpResponse;
  try {
    response = await REFLECT_APPLY(fetchPort, undefined, [KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT, init]);
  } catch {
    if (signal.aborted) throw createAbortError();
    throw new KnowledgeDeepSeekTransportError("http_failed");
  }
  if (signal.aborted) {
    cancelResponseBody(response.body);
    throw createAbortError();
  }
  if (!Number.isSafeInteger(response.status) || response.status !== 200) {
    cancelResponseBody(response.body);
    throw createHttpError(response.status);
  }
  if (response.redirected || response.url !== KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT) {
    cancelResponseBody(response.body);
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  let contentType: string | null;
  try {
    contentType = response.headers.get("content-type");
  } catch {
    cancelResponseBody(response.body);
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    cancelResponseBody(response.body);
    throw new KnowledgeDeepSeekTransportError("response_invalid");
  }
  const bytes = await readBoundedResponseBytes(response, signal);
  if (signal.aborted) throw createAbortError();
  return parseProviderResponse(bytes, captured.model, captured.configuration.maxTokens);
}

/**
 * Creates one full-profile-bound private DeepSeek route.
 *
 * The caller must pass a native-fetch-backed port already bound to the owning
 * Windows renderer lifecycle. The factory captures only the exact profile,
 * plaintext credential, and port; it never reads settings or logs provider data.
 */
export function createKnowledgeDeepSeekPrivateRoute(
  profile: KnowledgeBundlePipelineProfile,
  apiKeyValue: string,
  fetchPort: KnowledgeDeepSeekFetchPort
): KnowledgePrivateModelRoute {
  if (typeof fetchPort !== "function") {
    throw new KnowledgeDeepSeekTransportError("dependency_invalid");
  }
  const captured = captureProfile(profile);
  const apiKey = captureCredential(apiKeyValue);
  if (KNOWLEDGE_COMPILER_PROMPT_CONTRACT_VERSION !== 1) {
    throw new KnowledgeDeepSeekTransportError("configuration_unsupported");
  }
  return bindKnowledgePrivateModelRouteToProfile(captured.profile, (stage, request, signal) =>
    invokeDeepSeek(stage, request, signal, captured, apiKey, fetchPort)
  );
}
