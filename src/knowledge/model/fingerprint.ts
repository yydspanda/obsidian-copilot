import type {
  JsonValue,
  KnowledgeBundleConfig,
  PipelineFingerprintInput,
} from "@/knowledge/model/types";
import { sha256, sha256Bytes } from "@/utils/hash";

// Capturing this intrinsic accessor is intentional; Reflect.apply supplies the candidate receiver.
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

/**
 * Checks whether an unknown value is a plain JSON object.
 *
 * @param value - Runtime value to inspect
 * @returns Whether the value has a plain object or null prototype
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Serializes one runtime value as canonical JSON while rejecting non-JSON data.
 *
 * @param value - Runtime value to serialize
 * @param ancestors - Objects currently on the recursion stack
 * @returns Canonical JSON representation
 */
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

/**
 * Rejects configuration fields likely to contain credentials before hashing.
 *
 * @param value - Compiler, parser, or model configuration supplied by a caller allowlist
 * @param ancestors - Objects already inspected on the current recursion stack
 */
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

/**
 * Rejects credential-like fields before a detached configuration is retained or fingerprinted.
 *
 * @param value - Strict detached JSON configuration
 */
export function assertKnowledgeConfigurationContainsNoSecrets(value: unknown): void {
  assertConfigurationContainsNoSecrets(value, new Set<object>());
}

/**
 * Normalizes only line endings for a citation excerpt.
 *
 * Whitespace and a UTF-8 BOM remain significant so the stored excerpt can be
 * checked against the exact artifact text that the model actually observed.
 *
 * @param excerpt - Source excerpt supporting a claim
 * @returns Excerpt with CRLF and CR line endings normalized to LF
 */
export function normalizeCitationText(excerpt: string): string {
  return excerpt.replace(/\r\n?/g, "\n");
}

/**
 * Tests exact Uint8Array identity without trusting a spoofable toStringTag.
 *
 * The captured TypedArray intrinsic reads the internal typed-array name across
 * renderer realms. Uint16Array, DataView, and plain-object tag spoofing fail.
 *
 * @param value - Unknown exact-byte candidate
 * @returns Whether the value is a Uint8Array-compatible byte view
 */
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

/**
 * Computes the SHA-256 identity of exact source bytes.
 *
 * Text is encoded as UTF-8 without BOM or line-ending normalization. Binary
 * inputs support PDF and future attachment parsers without lossy conversion.
 *
 * @param content - Exact source text or bytes
 * @returns Lowercase hexadecimal SHA-256 digest
 */
export function createSourceContentHash(content: string | Uint8Array | ArrayBuffer): string {
  return typeof content === "string" ? sha256(content) : sha256Bytes(content);
}

/**
 * Computes the exact text hash used by before/after compare-and-swap checks.
 *
 * @param content - Exact text read from or proposed for a Vault file
 * @returns Lowercase hexadecimal SHA-256 digest
 */
export function createFileContentHash(content: string): string {
  return sha256(content);
}

/**
 * Computes a stable hash for the exact supporting excerpt used by a locator.
 *
 * @param excerpt - Source excerpt supporting a claim
 * @returns Lowercase hexadecimal SHA-256 digest
 */
export function createQuoteHash(excerpt: string): string {
  return sha256(normalizeCitationText(excerpt));
}

/**
 * Serializes JSON deterministically by sorting every object key recursively.
 * Array order remains significant because it may encode pipeline behavior.
 *
 * @param value - JSON-compatible value
 * @returns Canonical JSON representation
 */
export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeValue(value, new Set<object>());
}

/**
 * Computes the exact identity of compiler-visible Bundle configuration.
 *
 * Callers must pass a strictly parsed and semantically validated Bundle. Array
 * ordering remains significant because the compiler and model receive the same
 * source-root ordering.
 *
 * @param bundle - Strict complete Bundle behavior and boundary configuration
 * @returns Domain-separated lowercase SHA-256 digest
 */
export function createKnowledgeBundleConfigDigest(bundle: KnowledgeBundleConfig): string {
  return sha256(`knowledge-bundle-config-v1\n${canonicalizeJson(bundle as unknown as JsonValue)}`);
}

/**
 * Computes a deterministic fingerprint for every behavior-affecting pipeline input.
 *
 * Callers must pass allowlisted model/parser configuration rather than complete
 * provider settings. Common credential field names are rejected defensively.
 *
 * @param input - Versioned compiler, parser, schema, model, and output configuration
 * @returns Namespaced lowercase hexadecimal SHA-256 digest
 */
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
