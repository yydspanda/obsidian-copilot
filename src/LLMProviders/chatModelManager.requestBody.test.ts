import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS, ReasoningEffort } from "@/constants";

import * as obsidianModule from "obsidian";

import ChatModelManager from "./chatModelManager";

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

// Runs the real clients so a limit Copilot left out but the SDK puts back fails here.
// https://github.com/logancyang/obsidian-copilot-preview/issues/312

const OPENAI_RESPONSE = JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const ANTHROPIC_RESPONSE = JSON.stringify({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
});

// Providers disagree on accepted sampling values, so Copilot sends none of them.
// https://github.com/logancyang/obsidian-copilot/issues/2959
const RETIRED_SAMPLING_PARAMS = ["temperature", "top_p", "frequency_penalty"];

function captureRequestBody(responseText: string): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  const parsedResponse = JSON.parse(responseText) as Record<string, unknown>;
  setRequestUrlImpl((request: { body?: string }) => {
    captured = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};
    return Promise.resolve({
      status: 200,
      text: responseText,
      json: parsedResponse,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "application/json" },
    });
  });
  return () => captured;
}

function wireModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    enabled: true,
    enableCors: true,
    stream: false,
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    ...overrides,
  };
}

function respondWithBadRequest(message: string): void {
  const body = JSON.stringify({ error: { message, type: "invalid_request_error" } });
  setRequestUrlImpl(() =>
    Promise.resolve({
      status: 400,
      text: body,
      json: JSON.parse(body) as Record<string, unknown>,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "application/json" },
    })
  );
}

async function send(model: CustomModel): Promise<void> {
  const instance = await ChatModelManager.getInstance().createModelInstanceFromBridged(model);
  await instance.invoke("hi");
}

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    describe("createModelInstanceFromBridged()", () => {
      it("https://github.com/yydspanda/obsidian-copilot/issues/3 sends a persisted DeepSeek V4 Flash alias as the canonical Flash wire identity", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(
          wireModel({
            name: "deepseek-v4-flash",
            provider: ChatModelProviders.DEEPSEEK,
            baseUrl: "https://api.deepseek.com",
          })
        );

        expect(body()).toMatchObject({
          model: "deepseek-flash",
          thinking: { type: "disabled" },
        });
        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("https://github.com/yydspanda/obsidian-copilot/issues/3 sends explicit thinking configuration for canonical Flash", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(
          wireModel({
            name: "deepseek-flash",
            provider: ChatModelProviders.DEEPSEEK,
            baseUrl: "https://api.deepseek.com/v1/",
            reasoningEffort: ReasoningEffort.HIGH,
          })
        );

        expect(body()).toMatchObject({
          model: "deepseek-flash",
          thinking: { type: "enabled" },
          reasoning_effort: "high",
        });
        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it.each([
        [ReasoningEffort.MINIMAL, { thinking: { type: "disabled" } }],
        [ReasoningEffort.HIGH, { thinking: { type: "enabled" }, reasoning_effort: "high" }],
        [ReasoningEffort.XHIGH, { thinking: { type: "enabled" }, reasoning_effort: "max" }],
      ])(
        "https://github.com/yydspanda/obsidian-copilot/issues/3 sends Pro unchanged with %s effort",
        async (reasoningEffort, thinking) => {
          const body = captureRequestBody(OPENAI_RESPONSE);
          await send(
            wireModel({
              name: "deepseek-v4-pro",
              provider: ChatModelProviders.DEEPSEEK,
              baseUrl: "https://api.deepseek.com",
              reasoningEffort,
            })
          );
          expect(body()).toMatchObject({ model: "deepseek-v4-pro", ...thinking });
          for (const param of RETIRED_SAMPLING_PARAMS) {
            expect(body()).not.toHaveProperty(param);
          }
        }
      );

      it("https://github.com/yydspanda/obsidian-copilot/issues/3 blocks unknown DeepSeek models before provider I/O", async () => {
        let requestCount = 0;
        setRequestUrlImpl(() => {
          requestCount += 1;
          return Promise.reject(new Error("A blocked model must not reach provider I/O"));
        });

        await expect(
          ChatModelManager.getInstance().createModelInstanceFromBridged(
            wireModel({
              name: "unknown-model",
              provider: ChatModelProviders.DEEPSEEK,
              baseUrl: "https://api.deepseek.com",
            })
          )
        ).rejects.toMatchObject({ code: "model_unsupported" });
        expect(requestCount).toBe(0);
      });

      it.each(["https://deepseek-proxy.example/v1", "https://api.deepseek.com/openai/v1"])(
        "https://github.com/yydspanda/obsidian-copilot/issues/3 preserves model identities on custom DeepSeek-compatible endpoint %s",
        async (baseUrl) => {
          const body = captureRequestBody(OPENAI_RESPONSE);

          await send(
            wireModel({
              name: "deepseek-v4-pro",
              provider: ChatModelProviders.DEEPSEEK,
              baseUrl,
            })
          );

          expect(body().model).toBe("deepseek-v4-pro");
        }
      );

      it("sends an OpenAI-compatible request with no output limit at all (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        expect(body()).not.toHaveProperty("max_tokens");
        expect(body()).not.toHaveProperty("max_completion_tokens");
      });

      it("sends no sampling parameters, so the provider applies its own defaults (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("sends Anthropic no sampling parameters either (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("surfaces a rejected request as the provider's own message rather than a connection failure (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        respondWithBadRequest("invalid temperature: only 1 is allowed for this model");

        const error = await send(wireModel()).catch((raised: unknown) => raised);

        expect(error).toMatchObject({ status: 400 });
        expect(String(error)).toContain("invalid temperature: only 1 is allowed for this model");
        expect(String(error)).not.toContain("Connection error");
      });

      it("stops retrying a request the provider has rejected (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        let attempts = 0;
        const body = JSON.stringify({ error: { message: "nope", type: "invalid_request_error" } });
        setRequestUrlImpl(() => {
          attempts += 1;
          return Promise.resolve({
            status: 400,
            text: body,
            json: JSON.parse(body) as Record<string, unknown>,
            arrayBuffer: new ArrayBuffer(0),
            headers: { "content-type": "application/json" },
          });
        });

        await expect(send(wireModel())).rejects.toThrow();

        expect(attempts).toBe(1);
      });

      it("sends an explicit per-model output limit when the model carries one", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel({ maxTokens: 8192 }));

        expect(body().max_tokens).toBe(8192);
      });

      it("sends Anthropic the ceiling the bridge resolved for the model (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        expect(body().max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      });
    });
  });
});
