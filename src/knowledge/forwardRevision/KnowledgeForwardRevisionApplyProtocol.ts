import type { JsonValue } from "@/knowledge/model/types";

/** Shared defensive limits for dedicated forward-Apply durable leaves. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPathCharacters: 1_024,
  maxBodyCharacters: 2_000_000,
  maxBodyBytes: 8_000_000,
  maxJsonDepth: 128,
  maxJsonNodes: 500_000,
  maxJsonStringCharacters: 24_000_000,
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Mutable accounting used only while detaching hostile JSON graphs. */
interface JsonCaptureBudget {
  nodes: number;
  stringCharacters: number;
}

/** Reports whether text consists exclusively of paired Unicode scalar values. */
export function isForwardApplyUnicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Reports whether text contains an unsupported C0 or C1 control. */
export function hasForwardApplyControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether an unknown value is a bounded canonical identifier. */
export function isForwardApplyIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isForwardApplyUnicodeScalarText(value) &&
    !hasForwardApplyControlCharacter(value)
  );
}

/** Reports whether an unknown value is a lowercase SHA-256 digest. */
export function isForwardApplyDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Reports whether an unknown value is a non-negative safe integer. */
export function isForwardApplyNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Reports whether an unknown value is a positive safe integer. */
export function isForwardApplyPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Reports whether exact file text is bounded and safe to persist. */
export function isForwardApplyBody(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxBodyCharacters ||
    !isForwardApplyUnicodeScalarText(value)
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return false;
    }
  }
  return (
    new TextEncoder().encode(value).byteLength <=
    KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxBodyBytes
  );
}

/** Captures one strict dense JSON value without invoking candidate accessors. */
function captureJsonValue(
  value: unknown,
  depth: number,
  budget: JsonCaptureBudget,
  ancestors: Set<object>
): JsonValue | undefined {
  budget.nodes += 1;
  if (
    budget.nodes > KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonNodes ||
    depth > KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonDepth
  ) {
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    budget.stringCharacters += value.length;
    return budget.stringCharacters <=
      KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonStringCharacters &&
      isForwardApplyUnicodeScalarText(value)
      ? value
      : undefined;
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) return undefined;
  try {
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor)) return undefined;
      const length = lengthDescriptor.value;
      if (!isForwardApplyNonNegativeInteger(length)) return undefined;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || keys.some((key) => typeof key === "symbol")) {
        return undefined;
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
        const captured = captureJsonValue(descriptor.value, depth + 1, budget, ancestors);
        if (captured === undefined) return undefined;
        result.push(captured);
      }
      return Object.freeze(result) as unknown as JsonValue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as string[]) {
      budget.stringCharacters += key.length;
      if (
        budget.stringCharacters >
          KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonStringCharacters ||
        !isForwardApplyUnicodeScalarText(key)
      ) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      const captured = captureJsonValue(descriptor.value, depth + 1, budget, ancestors);
      if (captured === undefined) return undefined;
      Object.defineProperty(result, key, {
        value: captured,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

/** Detaches a bounded strict JSON graph without invoking candidate code. */
export function captureForwardApplyJson(value: unknown): JsonValue | undefined {
  return captureJsonValue(value, 0, { nodes: 0, stringCharacters: 0 }, new Set<object>());
}

/** Captures one exact-key plain record through data descriptors only. */
export function captureForwardApplyRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(result, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Bounded descriptor-only walk used before freezing a detached graph in place. */
function freezeJsonValue(
  value: unknown,
  depth: number,
  budget: JsonCaptureBudget,
  ancestors: Set<object>
): void {
  budget.nodes += 1;
  if (
    budget.nodes > KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonNodes ||
    depth > KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonDepth
  ) {
    throw new TypeError("Forward Apply JSON exceeds its bounded graph limit");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Forward Apply JSON number is invalid");
    return;
  }
  if (typeof value === "string") {
    budget.stringCharacters += value.length;
    if (
      budget.stringCharacters >
        KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonStringCharacters ||
      !isForwardApplyUnicodeScalarText(value)
    ) {
      throw new TypeError("Forward Apply JSON string is invalid");
    }
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Forward Apply JSON graph is invalid");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("Forward Apply JSON array is invalid");
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
      const keys = Reflect.ownKeys(value);
      if (
        !isForwardApplyNonNegativeInteger(length) ||
        keys.length !== length + 1 ||
        keys.some((key) => typeof key === "symbol")
      ) {
        throw new TypeError("Forward Apply JSON array must be dense");
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("Forward Apply JSON array must contain data elements");
        }
        freezeJsonValue(descriptor.value, depth + 1, budget, ancestors);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Forward Apply JSON object is invalid");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError("Forward Apply JSON object key is invalid");
      }
      for (const key of keys as string[]) {
        budget.stringCharacters += key.length;
        if (
          budget.stringCharacters >
            KNOWLEDGE_FORWARD_REVISION_APPLY_PROTOCOL_LIMITS.maxJsonStringCharacters ||
          !isForwardApplyUnicodeScalarText(key)
        ) {
          throw new TypeError("Forward Apply JSON object key is invalid");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("Forward Apply JSON object accepts only data properties");
        }
        freezeJsonValue(descriptor.value, depth + 1, budget, ancestors);
      }
    }
    Object.freeze(value);
  } finally {
    ancestors.delete(value);
  }
}

/** Deeply freezes one bounded already-detached JSON-compatible graph. */
export function freezeForwardApplyJson<T>(value: T): Readonly<T> {
  try {
    freezeJsonValue(value, 0, { nodes: 0, stringCharacters: 0 }, new Set<object>());
    return value;
  } catch {
    throw new TypeError("Forward Apply JSON cannot be frozen safely");
  }
}
