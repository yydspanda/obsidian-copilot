import {
  type CompilerCandidateValidator,
  type CompilerTargetResolver,
  type KnowledgeCompileInput,
  type KnowledgeCompileResult,
  type KnowledgeCompilerDependencies,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import {
  bindKnowledgeCompilerModelAdapter,
  classifyKnowledgeCompilerModelAdapterFailure,
  type KnowledgeModelStageReporter,
  KnowledgePrivateModelRoute,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import { createKnowledgeProductionCompileInput } from "@/knowledge/compiler/KnowledgeProductionCompileInput";
import { KnowledgeAuthorizedSourcePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import {
  IngestExecutionClaim,
  type IngestExecutionContext,
} from "@/knowledge/ingest/queue/IngestQueue";
import type { KnowledgeIngestWorkStage } from "@/knowledge/model/types";

const MODEL_ROUTE_LEASE_TOKEN = Symbol("KnowledgeProductionModelRouteLease.constructor");
const MODEL_ROUTE_OWNER_TOKEN = Symbol("KnowledgeProductionModelRouteLeaseOwner.constructor");
const COMPILE_ATTEMPT_BUILDER_TOKEN = Symbol(
  "KnowledgeProductionCompileAttemptBuilder.constructor"
);
const COMPILE_ATTEMPT_TOKEN = Symbol("KnowledgeProductionCompileAttempt.constructor");

/** One Bundle-scoped private route created from the exact production preflight snapshot. */
export interface KnowledgeProductionModelRouteBinding {
  bundleId: string;
  route: KnowledgePrivateModelRoute;
}

/** Generation-owned non-model ports captured before any Queue attempt exists. */
export interface KnowledgeProductionCompileAttemptDependencies {
  targetResolver: CompilerTargetResolver;
  candidateValidator: CompilerCandidateValidator;
}

interface CapturedCompileAttemptPorts {
  resolveTargets: CompilerTargetResolver["resolve"];
  validateCandidate: CompilerCandidateValidator["validate"];
}

interface CapturedCompileAttemptDependencies extends CapturedCompileAttemptPorts {
  reportStage: IngestExecutionContext["reportStage"];
}

interface KnowledgeProductionModelRouteLeaseState {
  current: boolean;
  builderIssued: boolean;
  routes: Map<string, KnowledgePrivateModelRoute>;
}

interface KnowledgeProductionModelRouteLeaseOwnerState {
  lease: KnowledgeProductionModelRouteLease;
}

interface KnowledgeProductionCompileAttemptBuilderState {
  lease: KnowledgeProductionModelRouteLease;
  ports: CapturedCompileAttemptPorts;
}

interface KnowledgeProductionCompileAttemptState {
  lease: KnowledgeProductionModelRouteLease;
  preparation: KnowledgeAuthorizedSourcePreparation;
  input: KnowledgeCompileInput;
  dependencies: CapturedCompileAttemptDependencies;
  consumed: boolean;
}

const modelRouteLeaseStates = new WeakMap<object, KnowledgeProductionModelRouteLeaseState>();
const modelRouteOwnerStates = new WeakMap<object, KnowledgeProductionModelRouteLeaseOwnerState>();
const compileAttemptBuilderStates = new WeakMap<
  object,
  KnowledgeProductionCompileAttemptBuilderState
>();
const compileAttemptStates = new WeakMap<object, KnowledgeProductionCompileAttemptState>();
const reservedModelRoutePreparations = new WeakSet<object>();

/** Stable route-generation failure that retains no Bundle, model, request, or credential value. */
export class KnowledgeProductionModelRouteLeaseError extends Error {
  /** Creates one value-free production route capability failure. */
  constructor() {
    super("The production Knowledge model route generation is unavailable");
    this.name = "KnowledgeProductionModelRouteLeaseError";
  }
}

/** Creates the platform-standard cancellation used after synchronous route revocation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Checks one canonical non-empty Bundle identifier without normalizing it. */
function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Returns hidden state only for an authentic model-route lease. */
function requireLeaseState(value: unknown): KnowledgeProductionModelRouteLeaseState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = modelRouteLeaseStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Returns hidden state only for an authentic lifecycle owner. */
function requireOwnerState(value: unknown): KnowledgeProductionModelRouteLeaseOwnerState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = modelRouteOwnerStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Returns hidden state only for an authentic compile-attempt builder. */
function requireAttemptBuilderState(value: unknown): KnowledgeProductionCompileAttemptBuilderState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = compileAttemptBuilderStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Returns hidden state only for an authentic opaque compile attempt. */
function requireAttemptState(value: unknown): KnowledgeProductionCompileAttemptState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = compileAttemptStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Requires one current lease before or after a mutable asynchronous boundary. */
function assertLeaseCurrent(state: KnowledgeProductionModelRouteLeaseState): void {
  if (!state.current) {
    throw createAbortError();
  }
}

/** Reads one dense route-binding array after its caller installs a sanitized failure boundary. */
function snapshotRouteBindingsUnsafe(
  value: readonly KnowledgeProductionModelRouteBinding[]
): readonly KnowledgeProductionModelRouteBinding[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > 10_000 ||
    Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }

  const bindings: KnowledgeProductionModelRouteBinding[] = [];
  const bundleIds = new Set<string>();
  for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
    const element = Object.getOwnPropertyDescriptor(value, String(index));
    if (!element || !("value" in element) || !element.enumerable) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const record: unknown = element.value;
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const bundleId = Object.getOwnPropertyDescriptor(record, "bundleId");
    const route = Object.getOwnPropertyDescriptor(record, "route");
    if (
      Reflect.ownKeys(record).length !== 2 ||
      !bundleId ||
      !("value" in bundleId) ||
      !bundleId.enumerable ||
      !isCanonicalIdentifier(bundleId.value) ||
      !route ||
      !("value" in route) ||
      !route.enumerable ||
      bundleIds.has(bundleId.value)
    ) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    KnowledgePrivateModelRoute.assert(route.value);
    bundleIds.add(bundleId.value);
    bindings.push(Object.freeze({ bundleId: bundleId.value, route: route.value }));
  }
  return Object.freeze(bindings);
}

/** Snapshots route bindings without allowing Proxy traps or route errors to escape. */
function snapshotRouteBindings(
  value: readonly KnowledgeProductionModelRouteBinding[]
): readonly KnowledgeProductionModelRouteBinding[] {
  try {
    return snapshotRouteBindingsUnsafe(value);
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

/** Finds and captures one callable data method without evaluating accessors. */
function captureDataMethod<T extends (...args: never[]) => unknown>(
  receiver: object,
  key: string
): T {
  try {
    let current: object | null = receiver;
    const visited = new Set<object>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new TypeError("Expected a callable data method");
        }
        const method = descriptor.value as T;
        return ((...args: never[]) => {
          const result: unknown = Reflect.apply(method, receiver, args);
          return result;
        }) as T;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  throw new KnowledgeProductionModelRouteLeaseError();
}

/** Captures generation-owned ports after its caller installs a sanitized failure boundary. */
function captureAttemptPortsUnsafe(
  value: KnowledgeProductionCompileAttemptDependencies
): CapturedCompileAttemptPorts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const targetResolver = Object.getOwnPropertyDescriptor(value, "targetResolver");
  const candidateValidator = Object.getOwnPropertyDescriptor(value, "candidateValidator");
  const targetResolverValue: unknown =
    targetResolver && "value" in targetResolver ? targetResolver.value : undefined;
  const candidateValidatorValue: unknown =
    candidateValidator && "value" in candidateValidator ? candidateValidator.value : undefined;
  if (
    Reflect.ownKeys(value).length !== 2 ||
    !targetResolver ||
    !("value" in targetResolver) ||
    !targetResolver.enumerable ||
    typeof targetResolverValue !== "object" ||
    targetResolverValue === null ||
    !candidateValidator ||
    !("value" in candidateValidator) ||
    !candidateValidator.enumerable ||
    typeof candidateValidatorValue !== "object" ||
    candidateValidatorValue === null
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return Object.freeze({
    resolveTargets: captureDataMethod<CompilerTargetResolver["resolve"]>(
      targetResolverValue,
      "resolve"
    ),
    validateCandidate: captureDataMethod<CompilerCandidateValidator["validate"]>(
      candidateValidatorValue,
      "validate"
    ),
  });
}

/** Captures exact generation ports without allowing Proxy traps or dependency errors to escape. */
function captureAttemptPorts(
  value: KnowledgeProductionCompileAttemptDependencies
): CapturedCompileAttemptPorts {
  try {
    return captureAttemptPortsUnsafe(value);
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

interface CapturedExecutionContext {
  job: ReturnType<IngestExecutionClaim["getJob"]>;
  claim: IngestExecutionClaim;
  signal: AbortSignal;
  reportStage: IngestExecutionContext["reportStage"];
}

/** Captures an exact Queue context without invoking accessors or trusting copied DTOs. */
function captureExecutionContextUnsafe(value: IngestExecutionContext): CapturedExecutionContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const expectedKeys = ["executionClaim", "job", "reportStage", "signal"];
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== "string") ||
    (actualKeys as string[]).sort().some((key, index) => key !== expectedKeys[index])
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const readData = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    return descriptor.value;
  };
  const job = readData("job");
  const claim = readData("executionClaim");
  const signal = readData("signal");
  const reportStage = readData("reportStage");
  IngestExecutionClaim.assert(claim);
  if (
    typeof reportStage !== "function" ||
    !claim.matchesExecutionContext(job, signal, reportStage) ||
    !claim.isCurrent()
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const exactJob = claim.getJob();
  const exactSignal = claim.getSignal();
  return Object.freeze({
    job: exactJob,
    claim,
    signal: exactSignal,
    reportStage: async (stage: KnowledgeIngestWorkStage): Promise<void> => {
      const result: unknown = Reflect.apply(reportStage, value, [stage]);
      await result;
    },
  });
}

/** Captures one Queue context while collapsing Proxy and claim failures. */
function captureExecutionContext(value: IngestExecutionContext): CapturedExecutionContext {
  try {
    return captureExecutionContextUnsafe(value);
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

/** Requires the preparation proof to identify the exact Queue processing attempt. */
function assertPreparationMatchesContext(
  preparation: KnowledgeAuthorizedSourcePreparation,
  context: CapturedExecutionContext
): void {
  const claim = preparation.getClaim();
  const job = context.job;
  if (
    preparation.getSignal() !== context.signal ||
    job.status !== "processing" ||
    job.stage !== "parsing" ||
    claim.bundleId !== job.bundleId ||
    claim.jobId !== job.id ||
    claim.sourceId !== job.sourceId ||
    claim.sourceContentHash !== job.sourceContentHash ||
    claim.pipelineFingerprint !== job.pipelineFingerprint ||
    claim.inputRevision !== job.inputRevision ||
    claim.attempt !== job.attempt ||
    claim.startedAt !== job.startedAt
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

/** Advances the durable Queue stage while guarding the exact route generation and signal. */
async function reportAttemptStage(
  state: KnowledgeProductionModelRouteLeaseState,
  preparation: KnowledgeAuthorizedSourcePreparation,
  captured: CapturedCompileAttemptDependencies,
  stage: KnowledgeIngestWorkStage
): Promise<void> {
  const signal = preparation.getSignal();
  assertLeaseCurrent(state);
  if (signal.aborted) throw createAbortError();
  await Reflect.apply(captured.reportStage, undefined, [stage]);
  assertLeaseCurrent(state);
  if (signal.aborted) throw createAbortError();
}

/** Wraps attempt ports with route-generation, Queue-signal, and Runtime reproof checks. */
function createGuardedCompilerDependencies(
  state: KnowledgeProductionModelRouteLeaseState,
  preparation: KnowledgeAuthorizedSourcePreparation,
  route: KnowledgePrivateModelRoute,
  captured: CapturedCompileAttemptDependencies
): KnowledgeCompilerDependencies {
  const signal = preparation.getSignal();
  const assertSignal = (candidate: AbortSignal): void => {
    assertLeaseCurrent(state);
    if (candidate !== signal || signal.aborted) {
      throw createAbortError();
    }
  };
  const reportStage: KnowledgeModelStageReporter = async (stage) =>
    reportAttemptStage(state, preparation, captured, stage);
  const targetResolver: CompilerTargetResolver = Object.freeze({
    resolve: async (
      targets: Parameters<CompilerTargetResolver["resolve"]>[0],
      candidateSignal: AbortSignal
    ) => {
      assertSignal(candidateSignal);
      await reportAttemptStage(state, preparation, captured, "associating");
      assertSignal(candidateSignal);
      await preparation.reprove("associating");
      assertSignal(candidateSignal);
      const result = await captured.resolveTargets(targets, candidateSignal);
      assertSignal(candidateSignal);
      await preparation.reprove("associating");
      assertSignal(candidateSignal);
      return result;
    },
  });
  const candidateValidator: CompilerCandidateValidator = Object.freeze({
    validate: async (
      input: Parameters<CompilerCandidateValidator["validate"]>[0],
      candidateSignal: AbortSignal
    ) => {
      assertSignal(candidateSignal);
      await reportAttemptStage(state, preparation, captured, "validating");
      assertSignal(candidateSignal);
      await preparation.reprove("validating");
      assertSignal(candidateSignal);
      const result = await captured.validateCandidate(input, candidateSignal);
      assertSignal(candidateSignal);
      await preparation.reprove("validating");
      assertSignal(candidateSignal);
      return result;
    },
  });
  const model = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
  return Object.freeze({
    model,
    classifyModelFailure: classifyKnowledgeCompilerModelAdapterFailure,
    targetResolver,
    candidateValidator,
  });
}

/** Opaque, single-use join of one Queue attempt and its fully derived Compiler input. */
export class KnowledgeProductionCompileAttempt {
  private declare readonly productionCompileAttemptBrand: void;

  /** Rejects direct construction without the module-private builder token. */
  constructor(token: symbol) {
    if (token !== COMPILE_ATTEMPT_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    Object.freeze(this);
  }

  /** Authenticates only a module-minted production compile attempt. */
  static assert(value: unknown): asserts value is KnowledgeProductionCompileAttempt {
    requireAttemptState(value);
  }
}

Object.freeze(KnowledgeProductionCompileAttempt.prototype);
Object.freeze(KnowledgeProductionCompileAttempt);

/** Generation-bound builder that can mint attempts only from exact Queue contexts. */
export class KnowledgeProductionCompileAttemptBuilder {
  /** Rejects direct construction without the owning route lease. */
  constructor(
    token: symbol,
    lease: KnowledgeProductionModelRouteLease,
    ports: CapturedCompileAttemptPorts
  ) {
    if (token !== COMPILE_ATTEMPT_BUILDER_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    requireLeaseState(lease);
    compileAttemptBuilderStates.set(this, Object.freeze({ lease, ports }));
    Object.freeze(this);
  }

  /** Authenticates only a builder issued by one current route generation. */
  static assert(value: unknown): asserts value is KnowledgeProductionCompileAttemptBuilder {
    requireAttemptBuilderState(value);
  }

  /**
   * Binds preparation, claim, signal, reporter, Queue time, and derived input once.
   *
   * @param preparation - Authentic Runtime/workflow source preparation
   * @param context - Exact Queue-issued execution context
   * @returns Opaque attempt consumable only by this builder's route lease
   */
  async build(
    preparation: KnowledgeAuthorizedSourcePreparation,
    context: IngestExecutionContext
  ): Promise<KnowledgeProductionCompileAttempt> {
    const builderState = requireAttemptBuilderState(this);
    const leaseState = requireLeaseState(builderState.lease);
    assertLeaseCurrent(leaseState);
    try {
      KnowledgeAuthorizedSourcePreparation.assert(preparation);
    } catch {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const capturedContext = captureExecutionContext(context);
    assertPreparationMatchesContext(preparation, capturedContext);
    const foundation = preparation.getPreparation();
    const route = leaseState.routes.get(foundation.bundle.id);
    if (!route || !route.matchesProfile(preparation.getProfile())) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    if (reservedModelRoutePreparations.has(preparation)) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    reservedModelRoutePreparations.add(preparation);
    await preparation.reprove("parsing");
    assertLeaseCurrent(leaseState);
    if (capturedContext.signal.aborted) throw createAbortError();
    if (!capturedContext.claim.isCurrent()) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    assertPreparationMatchesContext(preparation, capturedContext);

    let input: KnowledgeCompileInput;
    try {
      input = createKnowledgeProductionCompileInput(foundation, capturedContext.job.createdAt);
    } catch {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const attempt = new KnowledgeProductionCompileAttempt(COMPILE_ATTEMPT_TOKEN);
    compileAttemptStates.set(attempt, {
      lease: builderState.lease,
      preparation,
      input,
      dependencies: Object.freeze({
        ...builderState.ports,
        reportStage: capturedContext.reportStage,
      }),
      consumed: false,
    });
    return attempt;
  }
}

Object.freeze(KnowledgeProductionCompileAttemptBuilder.prototype);
Object.freeze(KnowledgeProductionCompileAttemptBuilder);

/** Opaque preflight-owned route capability that never exposes routes, settings, or credentials. */
export class KnowledgeProductionModelRouteLease {
  /** Rejects direct construction without the module-private owner token. */
  constructor(token: symbol, routes: readonly KnowledgeProductionModelRouteBinding[]) {
    if (token !== MODEL_ROUTE_LEASE_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const bindings = snapshotRouteBindings(routes);
    modelRouteLeaseStates.set(this, {
      current: true,
      builderIssued: false,
      routes: new Map(bindings.map(({ bundleId, route }) => [bundleId, route])),
    });
    Object.freeze(this);
  }

  /** Authenticates only a module-minted route lease. */
  static assert(value: unknown): asserts value is KnowledgeProductionModelRouteLease {
    requireLeaseState(value);
  }

  /** Reports whether this exact preflight generation still retains its private routes. */
  isCurrent(): boolean {
    return requireLeaseState(this).current;
  }

  /** Throws synchronously after Settings, Projects, Runtime, or plugin invalidation. */
  assertCurrent(): void {
    assertLeaseCurrent(requireLeaseState(this));
  }

  /** Checks that this generation owns exactly the supplied stable Bundle identities. */
  coversBundleIds(bundleIds: readonly string[]): boolean {
    const state = requireLeaseState(this);
    try {
      if (!state.current || !Array.isArray(bundleIds) || bundleIds.length !== state.routes.size) {
        return false;
      }
      const seen = new Set<string>();
      for (const bundleId of bundleIds) {
        if (!isCanonicalIdentifier(bundleId) || seen.has(bundleId) || !state.routes.has(bundleId)) {
          return false;
        }
        seen.add(bundleId);
      }
      return seen.size === state.routes.size;
    } catch {
      return false;
    }
  }

  /**
   * Captures generation-owned target and validation ports into an opaque builder.
   *
   * @param dependencies - Fixed non-model ports for this production generation
   * @returns Builder that accepts only exact Queue preparation contexts
   */
  createAttemptBuilder(
    dependencies: KnowledgeProductionCompileAttemptDependencies
  ): KnowledgeProductionCompileAttemptBuilder {
    const state = requireLeaseState(this);
    assertLeaseCurrent(state);
    if (state.builderIssued) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const ports = captureAttemptPorts(dependencies);
    assertLeaseCurrent(state);
    if (state.builderIssued) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    state.builderIssued = true;
    return new KnowledgeProductionCompileAttemptBuilder(COMPILE_ATTEMPT_BUILDER_TOKEN, this, ports);
  }

  /**
   * Consumes one exact opaque attempt without accepting caller-spliceable DTOs or ports.
   *
   * @param attempt - One builder-minted, generation-bound compile attempt
   * @returns Controlled Compiler result for this exact attempt
   */
  async compile(attempt: KnowledgeProductionCompileAttempt): Promise<KnowledgeCompileResult> {
    const state = requireLeaseState(this);
    assertLeaseCurrent(state);
    const attemptState = requireAttemptState(attempt);
    if (attemptState.lease !== this || attemptState.consumed) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    attemptState.consumed = true;
    const { preparation, input, dependencies } = attemptState;
    const signal = preparation.getSignal();
    if (signal.aborted) throw createAbortError();
    const foundation = preparation.getPreparation();
    const route = state.routes.get(foundation.bundle.id);
    if (!route) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    await preparation.reprove("parsing");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    const compiler = new KnowledgeCompiler(
      createGuardedCompilerDependencies(state, preparation, route, dependencies)
    );
    const result = await compiler.compile(input, signal);
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    await reportAttemptStage(state, preparation, dependencies, "validating");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    await preparation.reprove("validating");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    return result;
  }
}

Object.freeze(KnowledgeProductionModelRouteLease.prototype);
Object.freeze(KnowledgeProductionModelRouteLease);

/** Lifecycle-only close authority kept out of the admission passed to worker composition. */
export class KnowledgeProductionModelRouteLeaseOwner {
  /** Rejects direct construction without the module-private factory token. */
  constructor(token: symbol, bindings: readonly KnowledgeProductionModelRouteBinding[]) {
    if (token !== MODEL_ROUTE_OWNER_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const lease = new KnowledgeProductionModelRouteLease(MODEL_ROUTE_LEASE_TOKEN, bindings);
    modelRouteOwnerStates.set(this, Object.freeze({ lease }));
    Object.freeze(this);
  }

  /** Authenticates only a module-minted lifecycle owner. */
  static assert(value: unknown): asserts value is KnowledgeProductionModelRouteLeaseOwner {
    requireOwnerState(value);
  }

  /** Returns the close-incapable lease admitted to production workflow composition. */
  getLease(): KnowledgeProductionModelRouteLease {
    return requireOwnerState(this).lease;
  }

  /** Synchronously revokes the lease and releases all retained route closures. */
  close(): void {
    const state = requireLeaseState(requireOwnerState(this).lease);
    if (!state.current) return;
    state.current = false;
    state.routes.clear();
  }
}

Object.freeze(KnowledgeProductionModelRouteLeaseOwner.prototype);
Object.freeze(KnowledgeProductionModelRouteLeaseOwner);

/** Creates one lifecycle-owned private route generation from preflight-created bindings. */
export function createKnowledgeProductionModelRouteLeaseOwner(
  bindings: readonly KnowledgeProductionModelRouteBinding[]
): KnowledgeProductionModelRouteLeaseOwner {
  return new KnowledgeProductionModelRouteLeaseOwner(MODEL_ROUTE_OWNER_TOKEN, bindings);
}
