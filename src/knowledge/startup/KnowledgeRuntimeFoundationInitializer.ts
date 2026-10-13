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
