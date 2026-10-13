/**
 * Legacy chat (Google, Groq) needs the host-only base URL; opencode needs the versioned one.
 * Persisted rows keep whatever the user pasted and each consumer normalizes.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/152
 */

function trimBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

export function googleHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/\/v1(beta)?$/i, "") || undefined;
}

export function groqHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/(\/openai\/v1|\/openai|\/v1)$/i, "") || undefined;
}

const CATALOG_DEFAULT_ORIGINS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  // Official direct DeepSeek requests use a reviewed model-identity policy;
  // genuine compatible proxies must retain their own model namespace.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com",
  openai: "https://api.openai.com",
};

const DEFAULT_ENDPOINT_PATHS = new Set(["", "/v1", "/v1beta", "/openai", "/openai/v1"]);
const DEEPSEEK_DEFAULT_ENDPOINT_PATHS = new Set(["", "/v1"]);

export function isCatalogProviderDefaultEndpoint(
  catalogProviderId: string | undefined,
  baseUrl: string
): boolean {
  if (!catalogProviderId) return false;
  const defaultOrigin = CATALOG_DEFAULT_ORIGINS[catalogProviderId];
  if (!defaultOrigin) return false;
  try {
    const url = new URL(baseUrl.trim());
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    // DeepSeek's reviewed direct API has only host and `/v1` spellings. Paths
    // borrowed from Google/Groq are compatible endpoint overrides even on the
    // same host and must retain their own model namespace.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    const acceptedPaths =
      catalogProviderId === "deepseek" ? DEEPSEEK_DEFAULT_ENDPOINT_PATHS : DEFAULT_ENDPOINT_PATHS;
    return url.origin === defaultOrigin && acceptedPaths.has(path);
  } catch {
    return false;
  }
}
