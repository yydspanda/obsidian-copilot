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
