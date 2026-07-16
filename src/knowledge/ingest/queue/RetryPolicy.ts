/** Configuration for bounded exponential retry scheduling. */
export interface RetryPolicyConfig {
  /** Total executions allowed, including the initial execution. */
  maxAttempts: number;
  /** Delay after the first failed execution. */
  baseDelayMs: number;
  /** Hard upper bound for a jittered automatic retry delay. */
  maxDelayMs: number;
  /** Symmetric random spread around the exponential delay, from zero to one. */
  jitterRatio: number;
}

/** Runtime facts supplied after one ingest execution has failed. */
export interface RetryContext {
  /** Number of completed executions, including the execution that just failed. */
  attempt: number;
  /** Whether the normalized failure is safe to retry. */
  retryable: boolean;
  /** Explicit provider classification; never inferred from an error message or code. */
  rateLimited: boolean;
  /** Optional provider-directed wait retained on a rate-limit pause. */
  retryAfterMs?: number;
}

/** Bounded action selected after a failed ingest execution. */
export type RetryDecision =
  | { kind: "retry"; delayMs: number }
  | { kind: "pause"; reason: "rate_limit"; retryAfterMs?: number }
  | { kind: "fail"; reason: "not_retryable" | "attempts_exhausted" };

/** Injectable source of a fractional random value in the range [0, 1). */
export type RetryRandomSource = () => number;

/** Port consumed by the ingest queue to classify a failed execution. */
export interface RetryPolicy {
  /**
   * Selects an automatic retry, explicit pause, or terminal failure.
   *
   * @param context - Validated facts about the execution that just failed
   * @returns Durable action for the queue state machine
   */
  decide(context: RetryContext): RetryDecision;
}

/** Reports invalid policy configuration before the policy can schedule work. */
export class RetryPolicyConfigurationError extends Error {
  /**
   * Creates a stable configuration validation error.
   *
   * @param field - Invalid configuration field
   * @param detail - Human-readable validation detail
   */
  constructor(
    public readonly field: keyof RetryPolicyConfig | "random",
    detail: string
  ) {
    super(`Invalid retry policy configuration '${field}': ${detail}`);
    this.name = "RetryPolicyConfigurationError";
  }
}

/** Reports invalid runtime facts instead of producing an unsafe queue transition. */
export class RetryPolicyContextError extends Error {
  /**
   * Creates a stable retry-context validation error.
   *
   * @param field - Invalid context field
   * @param detail - Human-readable validation detail
   */
  constructor(
    public readonly field: keyof RetryContext | "random",
    detail: string
  ) {
    super(`Invalid retry context '${field}': ${detail}`);
    this.name = "RetryPolicyContextError";
  }
}

/**
 * Checks whether a value is a positive integer that JavaScript can represent exactly.
 *
 * @param value - Runtime value to inspect
 * @returns Whether the value is a positive safe integer
 */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Checks whether a value is a non-negative integer that JavaScript can represent exactly.
 *
 * @param value - Runtime value to inspect
 * @returns Whether the value is a non-negative safe integer
 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates immutable policy configuration at construction time.
 *
 * @param config - Candidate retry configuration
 * @param random - Candidate injectable random source
 */
function validateConfiguration(config: RetryPolicyConfig, random: RetryRandomSource): void {
  if (!isPositiveSafeInteger(config.maxAttempts)) {
    throw new RetryPolicyConfigurationError("maxAttempts", "expected a positive safe integer");
  }
  if (!isPositiveSafeInteger(config.baseDelayMs)) {
    throw new RetryPolicyConfigurationError("baseDelayMs", "expected a positive safe integer");
  }
  if (!isPositiveSafeInteger(config.maxDelayMs)) {
    throw new RetryPolicyConfigurationError("maxDelayMs", "expected a positive safe integer");
  }
  if (config.maxDelayMs < config.baseDelayMs) {
    throw new RetryPolicyConfigurationError(
      "maxDelayMs",
      "expected a value greater than or equal to baseDelayMs"
    );
  }
  if (
    typeof config.jitterRatio !== "number" ||
    !Number.isFinite(config.jitterRatio) ||
    config.jitterRatio < 0 ||
    config.jitterRatio > 1
  ) {
    throw new RetryPolicyConfigurationError("jitterRatio", "expected a finite number from 0 to 1");
  }
  if (typeof random !== "function") {
    throw new RetryPolicyConfigurationError("random", "expected a function");
  }
}

/**
 * Validates facts originating at the execution boundary before deciding a transition.
 *
 * @param context - Candidate retry context
 */
function validateContext(context: RetryContext): void {
  if (!isPositiveSafeInteger(context.attempt)) {
    throw new RetryPolicyContextError("attempt", "expected a positive safe integer");
  }
  if (typeof context.retryable !== "boolean") {
    throw new RetryPolicyContextError("retryable", "expected a boolean");
  }
  if (typeof context.rateLimited !== "boolean") {
    throw new RetryPolicyContextError("rateLimited", "expected a boolean");
  }
  if (context.retryAfterMs !== undefined && !isNonNegativeSafeInteger(context.retryAfterMs)) {
    throw new RetryPolicyContextError(
      "retryAfterMs",
      "expected a non-negative safe integer when provided"
    );
  }
  if (!context.rateLimited && context.retryAfterMs !== undefined) {
    throw new RetryPolicyContextError(
      "retryAfterMs",
      "may only be provided for an explicitly rate-limited failure"
    );
  }
}

/**
 * Computes base × 2^(attempt - 1) without overflowing or looping for a huge attempt.
 *
 * @param baseDelayMs - Delay after the first failed execution
 * @param maxDelayMs - Hard delay cap
 * @param attempt - Completed execution count
 * @returns Capped safe-integer exponential delay
 */
function calculateCappedExponentialDelay(
  baseDelayMs: number,
  maxDelayMs: number,
  attempt: number
): number {
  let delayMs = baseDelayMs;
  let remainingDoublings = attempt - 1;

  while (remainingDoublings > 0 && delayMs < maxDelayMs) {
    if (delayMs > Math.floor(maxDelayMs / 2)) {
      return maxDelayMs;
    }
    delayMs *= 2;
    remainingDoublings -= 1;
  }

  return Math.min(delayMs, maxDelayMs);
}

/**
 * Applies symmetric multiplicative jitter while retaining a hard safe-integer cap.
 *
 * @param delayMs - Capped exponential delay
 * @param maxDelayMs - Hard delay cap
 * @param jitterRatio - Fractional symmetric spread
 * @param random - Injectable random source
 * @returns Jittered integer delay between zero and maxDelayMs
 */
function applyJitter(
  delayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
  random: RetryRandomSource
): number {
  if (jitterRatio === 0) {
    return delayMs;
  }

  const sample = random();
  if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RetryPolicyContextError(
      "random",
      "expected a finite number from 0 up to but not including 1"
    );
  }

  const spreadMs = delayMs * jitterRatio;
  const jitteredMs = delayMs - spreadMs + sample * spreadMs * 2;
  const boundedMs = Math.min(maxDelayMs, Math.max(0, jitteredMs));
  return Math.round(boundedMs);
}

/** Pure bounded exponential retry policy with an explicitly injected random source. */
export class ExponentialRetryPolicy implements RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;

  /**
   * Creates a validated retry policy independent of clocks, timers, and provider SDKs.
   *
   * @param config - Exponential retry bounds and jitter ratio
   * @param random - Fractional random source, injected for deterministic tests
   */
  constructor(
    config: RetryPolicyConfig,
    private readonly random: RetryRandomSource
  ) {
    validateConfiguration(config, random);
    this.maxAttempts = config.maxAttempts;
    this.baseDelayMs = config.baseDelayMs;
    this.maxDelayMs = config.maxDelayMs;
    this.jitterRatio = config.jitterRatio;
  }

  /**
   * Selects an automatic retry, explicit pause, or terminal failure.
   *
   * Non-retryable failures terminate immediately. The completed execution that
   * reaches maxAttempts also terminates. Explicit retryable rate limits pause
   * for queue/user coordination; only ordinary retryable failures receive an
   * automatically scheduled jittered delay.
   *
   * @param context - Facts about the execution that just failed
   * @returns Durable action for the queue state machine
   */
  decide(context: RetryContext): RetryDecision {
    validateContext(context);

    if (!context.retryable) {
      return { kind: "fail", reason: "not_retryable" };
    }
    if (context.attempt >= this.maxAttempts) {
      return { kind: "fail", reason: "attempts_exhausted" };
    }
    if (context.rateLimited) {
      return context.retryAfterMs === undefined
        ? { kind: "pause", reason: "rate_limit" }
        : { kind: "pause", reason: "rate_limit", retryAfterMs: context.retryAfterMs };
    }

    const exponentialDelayMs = calculateCappedExponentialDelay(
      this.baseDelayMs,
      this.maxDelayMs,
      context.attempt
    );
    return {
      kind: "retry",
      delayMs: applyJitter(exponentialDelayMs, this.maxDelayMs, this.jitterRatio, this.random),
    };
  }
}
