export interface RetryPolicyConfig {
  maxAttempts: number;

  baseDelayMs: number;

  maxDelayMs: number;

  jitterRatio: number;
}

export interface RetryContext {
  attempt: number;

  retryable: boolean;

  rateLimited: boolean;

  retryAfterMs?: number;
}

export type RetryDecision =
  | { kind: "retry"; delayMs: number }
  | { kind: "pause"; reason: "rate_limit"; retryAfterMs?: number }
  | { kind: "fail"; reason: "not_retryable" | "attempts_exhausted" };

export type RetryRandomSource = () => number;

export interface RetryPolicy {
  decide(context: RetryContext): RetryDecision;
}

export class RetryPolicyConfigurationError extends Error {
  constructor(
    public readonly field: keyof RetryPolicyConfig | "random",
    detail: string
  ) {
    super(`Invalid retry policy configuration '${field}': ${detail}`);
    this.name = "RetryPolicyConfigurationError";
  }
}

export class RetryPolicyContextError extends Error {
  constructor(
    public readonly field: keyof RetryContext | "random",
    detail: string
  ) {
    super(`Invalid retry context '${field}': ${detail}`);
    this.name = "RetryPolicyContextError";
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

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

export class ExponentialRetryPolicy implements RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;

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
