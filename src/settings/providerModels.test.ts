import { ChatModelProviders } from "@/constants";
import { parseModelsResponse } from "@/settings/providerModels";

describe("DeepSeek provider model catalog", () => {
  it("imports only current reviewed V4 identities", () => {
    const models = parseModelsResponse(ChatModelProviders.DEEPSEEK, {
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
        { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
        { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
        { id: "future-unreviewed-model", object: "model", owned_by: "deepseek" },
      ],
    });

    expect(models).toEqual([
      {
        id: "deepseek-v4-flash",
        name: "deepseek-v4-flash",
        provider: ChatModelProviders.DEEPSEEK,
      },
      {
        id: "deepseek-v4-pro",
        name: "deepseek-v4-pro",
        provider: ChatModelProviders.DEEPSEEK,
      },
    ]);
  });
});
