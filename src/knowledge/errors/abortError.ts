/**
 * Recognizes intentional cancellation without invoking candidate accessors.
 *
 * Same-realm platform errors retain their native brand. Detached or serialized
 * cross-realm failures are accepted only when a bounded prototype walk finds an
 * own data property whose exact value is `AbortError`. Native foreign-realm
 * DOMException instances keep their name behind an accessor, which this helper
 * deliberately does not invoke; async boundaries must also honor their associated
 * AbortSignal. Hostile accessors and Proxy traps fail closed.
 *
 * @param value - Unknown rejection value
 * @returns Whether the value represents platform-standard cancellation
 */
export function isKnowledgeAbortError(value: unknown): boolean {
  try {
    if (value instanceof DOMException) return value.name === "AbortError";
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return false;
    }
    let current: object | null = value;
    const visited = new Set<object>();
    while (current && visited.size < 16 && !visited.has(current)) {
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, "name");
      if (descriptor) {
        return "value" in descriptor && descriptor.value === "AbortError";
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return false;
  }
  return false;
}
