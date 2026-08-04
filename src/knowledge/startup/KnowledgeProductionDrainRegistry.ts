const productionDrains = new WeakMap<object, Promise<void>>();

/** Creates the value-free cancellation used by startup generation barriers. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Normalizes one owner-local drain so cleanup can never reject a later startup. */
function normalizeDrain(drain: Promise<void>): Promise<void> {
  return Promise.resolve(drain).then(
    () => undefined,
    () => undefined
  );
}

/**
 * Retains active or closing production work for one exact Vault lifecycle owner.
 *
 * Registering an active controller before it starts also protects overlapping
 * plugin hot reload: the next instance cannot run startup recovery until the
 * prior controller is closed and its exact Queue attempt has settled.
 *
 * @param owner - Stable Vault object shared by overlapping plugin instances
 * @param drain - Promise resolving only after the owned worker attempt settles
 */
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

/**
 * Waits for every active or closing production generation retained for one owner.
 *
 * Caller cancellation stops only this wait. It cannot erase the shared drain,
 * so a replacement generation must independently prove the same old work has
 * settled before its startup Gate can classify durable processing claims.
 *
 * @param owner - Stable Vault object whose prior generation must be drained
 * @param signal - Current startup generation cancellation signal
 */
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
