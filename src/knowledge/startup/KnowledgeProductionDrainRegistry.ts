const productionDrains = new WeakMap<object, Promise<void>>();

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function normalizeDrain(drain: Promise<void>): Promise<void> {
  return Promise.resolve(drain).then(
    () => undefined,
    () => undefined
  );
}

export function retainKnowledgeProductionDrain(owner: object, drain: Promise<void>): void {
  if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
    throw new TypeError("The Knowledge production drain owner is invalid");
  }
  const normalized = normalizeDrain(drain);
  const previous = productionDrains.get(owner);
  const retained = previous
    ? Promise.all([previous, normalized]).then(() => undefined)
    : normalized;
  productionDrains.set(owner, retained);
  void retained.then(() => {
    if (productionDrains.get(owner) === retained) {
      productionDrains.delete(owner);
    }
  });
}

export async function awaitKnowledgeProductionDrain(
  owner: object,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw createAbortError();
  const retained = productionDrains.get(owner);
  if (!retained) return;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (failure?: DOMException) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      if (failure) {
        reject(failure);
      } else {
        resolve();
      }
    };
    const onAbort = () => finish(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void retained.then(() => finish());
  });
  if (signal.aborted) throw createAbortError();
}
