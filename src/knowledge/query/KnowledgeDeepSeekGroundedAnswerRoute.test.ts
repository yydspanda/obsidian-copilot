import {
  createKnowledgeDeepSeekGroundedAnswerModelRoute,
  KNOWLEDGE_DEEPSEEK_API_BASE_URL,
  KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
  KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
  KnowledgeDeepSeekTransportError,
  type KnowledgeDeepSeekFetchPort,
  type KnowledgeDeepSeekHttpResponse,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import { createKnowledgeModelEndpointIdentity } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  createKnowledgeGroundedAnswerRequest,
  parseKnowledgeGroundedAnswerModelOutput,
} from "@/knowledge/query/KnowledgeGroundedAnswer";
import { createKnowledgeGroundedAnswerModelPort } from "@/knowledge/query/KnowledgeGroundedAnswerModelRoute";

const MODEL = "deepseek-v4-pro";

/** Creates the exact admitted profile shared with the Compiler preflight. */
function createProfile(): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: "personal",
    compiler: { version: "knowledge-compiler-v1", configuration: { protocolVersion: 1 } },
    parsers: [
      {
        id: "markdown-utf8",
        version: "1",
        pathSuffixes: [".md"],
        configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
      },
    ],
    model: {
      provider: "deepseek",
      model: MODEL,
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
        providerRouteIdentity: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-object-core-schema-v1",
        streaming: false,
        modelFallback: false,
        temperature: 0,
        maxTokens: 16_384,
        reasoningEffort: "high",
        verbosity: "medium",
        endpointIdentity: createKnowledgeModelEndpointIdentity(
          KNOWLEDGE_DEEPSEEK_API_BASE_URL
        ) as string,
      },
    },
    outputLanguage: "Chinese",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates one authentic read-only answer request. */
function createRequest() {
  return createKnowledgeGroundedAnswerRequest(
    "What is durable?",
    [
      {
        contextId: "context-1",
        pagePath: "Wiki/Durable.md",
        pageContentHash: "a".repeat(64),
        heading: "Durable",
        headingPath: ["Durable"],
        content: "Review state is durable.",
      },
    ],
    [
      {
        evidenceId: "evidence-1",
        contextId: "context-1",
        sourceExcerpt: "Review state survives application restart.",
        sourceRelation: "supports",
      },
    ]
  );
}

/** Creates a native-fetch-compatible DeepSeek JSON response. */
function createResponse(
  content: string,
  options: { status?: number; body?: ReadableStream<Uint8Array> | null } = {}
): KnowledgeDeepSeekHttpResponse {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      id: "answer-1",
      object: "chat.completion",
      model: MODEL,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    })
  );
  return {
    status: options.status ?? 200,
    redirected: false,
    url: KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT,
    headers: {
      get: (name) => {
        if (name.toLowerCase() === "content-type") return "application/json";
        if (name.toLowerCase() === "content-length") return String(bytes.byteLength);
        return null;
      },
    },
    body:
      options.body === undefined
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          })
        : options.body,
  };
}

describe("KnowledgeDeepSeekGroundedAnswerRoute", () => {
  it("performs one non-streaming JSON request and returns strict answer content", async () => {
    const request = createRequest();
    const fetchPort = jest.fn(async (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected encoded request text");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: MODEL,
        response_format: { type: "json_object" },
        stream: false,
        max_tokens: 8192,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      });
      expect(body).not.toHaveProperty("tools");
      expect(JSON.stringify(body)).toContain("Review state survives application restart.");
      expect(init.signal?.aborted).toBe(false);
      expect(typeof init.signal?.addEventListener).toBe("function");
      return createResponse(
        JSON.stringify({
          version: 1,
          contextDigest: request.contextDigest,
          status: "answered",
          claims: [
            {
              claimId: "claim-1",
              kind: "source_fact",
              text: "Review state survives restart.",
              evidenceIds: ["evidence-1"],
            },
          ],
          insufficientEvidence: [],
        })
      );
    });
    const route = createKnowledgeDeepSeekGroundedAnswerModelRoute(
      createProfile(),
      "sk-test",
      fetchPort
    );
    const port = createKnowledgeGroundedAnswerModelPort(route, jest.fn());
    const signal = new AbortController().signal;

    const output = await port.generate(request, signal);

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort.mock.calls[0][0]).toBe(KNOWLEDGE_DEEPSEEK_CHAT_ENDPOINT);
    expect(parseKnowledgeGroundedAnswerModelOutput(output, request).status).toBe("answered");
  });

  it("rejects copied requests before network and honors pre-aborted signals", async () => {
    const fetchPort = jest.fn(async () => createResponse("{}"));
    const route = createKnowledgeDeepSeekGroundedAnswerModelRoute(
      createProfile(),
      "sk-test",
      fetchPort
    );
    const port = createKnowledgeGroundedAnswerModelPort(route, jest.fn());
    const request = createRequest();

    await expect(port.generate({ ...request }, new AbortController().signal)).rejects.toBeDefined();
    const abort = new AbortController();
    abort.abort();
    await expect(port.generate(request, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures and performs no hidden retry", async () => {
    const responseCanary = "private-response-body";
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(responseCanary);
      },
    });
    const fetchPort: jest.MockedFunction<KnowledgeDeepSeekFetchPort> = jest.fn(
      async (_url: string, _init: RequestInit) => createResponse("{}", { status: 429, body })
    );
    const route = createKnowledgeDeepSeekGroundedAnswerModelRoute(
      createProfile(),
      "sk-test",
      fetchPort
    );
    const port = createKnowledgeGroundedAnswerModelPort(route, jest.fn());

    let failure: unknown;
    try {
      await port.generate(createRequest(), new AbortController().signal);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(KnowledgeDeepSeekTransportError);
    expect(KnowledgeDeepSeekTransportError.inspect(failure)).toBe("rate_limited");
    expect(String(failure)).not.toContain(responseCanary);
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });
});
