import type {
  JsonValue,
  KnowledgeBundleConfig,
  PipelineFingerprintInput,
} from "@/knowledge/model/types";
import { sha256, sha256Bytes } from "@/utils/hash";

// eslint-disable-next-line @typescript-eslint/unbound-method -- capture the intrinsic getter for a non-spoofable receiver check
const TYPED_ARRAY_TO_STRING_TAG_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  Symbol.toStringTag
)?.get;

const SENSITIVE_CONFIGURATION_KEYS = new Set([
  "apikey",
  "accesstoken",
  "auth",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "headers",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
]);

const SENSITIVE_CONFIGURATION_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "sessiontoken",
  "token",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeValue(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON accepts only finite numbers");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("Canonical JSON does not accept cyclic values");
    }
    ancestors.add(value);
    const serialized = `[${value.map((item) => canonicalizeValue(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }

  if (!isPlainObject(value)) {
    throw new TypeError("Canonical JSON accepts only JSON primitives, arrays, and plain objects");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not accept cyclic values");
  }

  ancestors.add(value);
  const properties = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key], ancestors)}`);
  ancestors.delete(value);
  return `{${properties.join(",")}}`;
}

function assertConfigurationContainsNoSecrets(value: unknown, ancestors: Set<object>): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Pipeline configuration does not accept cyclic values");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertConfigurationContainsNoSecrets(item, ancestors);
    }
  } else {
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en-US");
      if (
        SENSITIVE_CONFIGURATION_KEYS.has(normalizedKey) ||
        SENSITIVE_CONFIGURATION_KEY_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix))
      ) {
        throw new TypeError(`Pipeline configuration cannot include sensitive field '${key}'`);
      }
      assertConfigurationContainsNoSecrets(nestedValue, ancestors);
    }
  }
  ancestors.delete(value);
}

export function assertKnowledgeConfigurationContainsNoSecrets(value: unknown): void {
  assertConfigurationContainsNoSecrets(value, new Set<object>());
}

export function normalizeCitationText(excerpt: string): string {
  return excerpt.replace(/\r\n?/g, "\n");
}

export function isExactUint8Array(value: unknown): value is Uint8Array {
  if (!ArrayBuffer.isView(value) || !TYPED_ARRAY_TO_STRING_TAG_GETTER) {
    return false;
  }
  try {
    return Reflect.apply(TYPED_ARRAY_TO_STRING_TAG_GETTER, value, []) === "Uint8Array";
  } catch {
    return false;
  }
}

export function createSourceContentHash(content: string | Uint8Array | ArrayBuffer): string {
  return typeof content === "string" ? sha256(content) : sha256Bytes(content);
}

export function createFileContentHash(content: string): string {
  return sha256(content);
}

export function createQuoteHash(excerpt: string): string {
  return sha256(normalizeCitationText(excerpt));
}

export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeValue(value, new Set<object>());
}

export function createKnowledgeBundleConfigDigest(bundle: KnowledgeBundleConfig): string {
  return sha256(`knowledge-bundle-config-v1\n${canonicalizeJson(bundle as unknown as JsonValue)}`);
}

export function createPipelineFingerprint(input: PipelineFingerprintInput): string {
  assertKnowledgeConfigurationContainsNoSecrets(input.compilerConfiguration);
  assertKnowledgeConfigurationContainsNoSecrets(input.parser.configuration);
  assertKnowledgeConfigurationContainsNoSecrets(input.model.configuration);
  const fingerprintData: JsonValue = {
    version: input.version,
    contractVersion: input.contractVersion,
    bundleConfigDigest: input.bundleConfigDigest,
    compiler: {
      version: input.compilerVersion,
      configuration: input.compilerConfiguration,
    },
    parser: {
      id: input.parser.id,
      version: input.parser.version,
      configuration: input.parser.configuration,
    },
    schemaHash: input.schemaHash,
    model: {
      provider: input.model.provider,
      model: input.model.model,
      configuration: input.model.configuration,
    },
    outputLanguage: input.outputLanguage,
    okfVersion: input.okfVersion,
    citationContractVersion: input.citationContractVersion,
  };
  return sha256(`knowledge-pipeline-v1\n${canonicalizeJson(fingerprintData)}`);
}
