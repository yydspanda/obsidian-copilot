/**
 * Loads and initializes a Runtime only while the caller-owned lifecycle
 * generation remains current.
 *
 * Currentness is checked around every boundary where asynchronous work or
 * synchronous construction could hand control to a newer plugin lifecycle.
 *
 * @param loadModules Lazy module loader
 * @param isCurrent Returns whether the captured lifecycle generation is current
 * @param createRuntime Constructs the Runtime from the loaded modules
 * @param initializeRuntime Performs the Runtime's asynchronous initialization
 * @returns The initialized Runtime, or undefined when the lifecycle became stale
 */
export async function initializeKnowledgeRuntimeForCurrentGeneration<Modules, Runtime>(
  loadModules: () => Promise<Modules>,
  isCurrent: () => boolean,
  createRuntime: (modules: Modules) => Runtime,
  initializeRuntime: (runtime: Runtime) => Promise<void>
): Promise<Runtime | undefined> {
  if (!isCurrent()) {
    return undefined;
  }

  const modules = await loadModules();
  if (!isCurrent()) {
    return undefined;
  }

  const runtime = createRuntime(modules);
  if (!isCurrent()) {
    return undefined;
  }

  await initializeRuntime(runtime);
  if (!isCurrent()) {
    return undefined;
  }

  return runtime;
}
