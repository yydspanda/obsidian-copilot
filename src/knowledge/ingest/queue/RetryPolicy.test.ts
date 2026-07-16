import {
  ExponentialRetryPolicy,
  RetryPolicyConfigurationError,
  RetryPolicyContextError,
  type RetryContext,
  type RetryPolicyConfig,
} from "@/knowledge/ingest/queue/RetryPolicy";

const DEFAULT_CONFIG: RetryPolicyConfig = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  jitterRatio: 0,
};

const DEFAULT_CONTEXT: RetryContext = {
  attempt: 1,
  retryable: true,
  rateLimited: false,
};

/** Creates a policy with explicit deterministic configuration overrides. */
function createPolicy(
  config: Partial<RetryPolicyConfig> = {},
  random: () => number = () => 0.5
): ExponentialRetryPolicy {
  return new ExponentialRetryPolicy({ ...DEFAULT_CONFIG, ...config }, random);
}

/** Captures a required thrown value without relying on Jest's untyped matcher overload. */
function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ExponentialRetryPolicy", () => {
  it("uses completed execution count for capped exponential backoff", () => {
    const policy = createPolicy();

    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 1 })).toEqual({
      kind: "retry",
      delayMs: 100,
    });
    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 2 })).toEqual({
      kind: "retry",
      delayMs: 200,
    });
    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 3 })).toEqual({
      kind: "retry",
      delayMs: 400,
    });
  });

  it("stops when the completed execution reaches maxAttempts", () => {
    const policy = createPolicy({ maxAttempts: 3 });

    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 3 })).toEqual({
      kind: "fail",
      reason: "attempts_exhausted",
    });
    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 4 })).toEqual({
      kind: "fail",
      reason: "attempts_exhausted",
    });
  });

  it("terminates a non-retryable failure before scheduling or pausing", () => {
    const random = jest.fn(() => 0.5);
    const policy = createPolicy({}, random);

    expect(
      policy.decide({
        ...DEFAULT_CONTEXT,
        retryable: false,
        rateLimited: true,
        retryAfterMs: 5_000,
      })
    ).toEqual({ kind: "fail", reason: "not_retryable" });
    expect(random).not.toHaveBeenCalled();
  });

  it("returns a structured pause only for an explicit retryable rate limit", () => {
    const random = jest.fn(() => 0.5);
    const policy = createPolicy({}, random);

    expect(
      policy.decide({
        ...DEFAULT_CONTEXT,
        rateLimited: true,
        retryAfterMs: 12_345,
      })
    ).toEqual({ kind: "pause", reason: "rate_limit", retryAfterMs: 12_345 });
    expect(policy.decide({ ...DEFAULT_CONTEXT, rateLimited: true })).toEqual({
      kind: "pause",
      reason: "rate_limit",
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("does not let a rate-limit pause bypass the maximum execution count", () => {
    const policy = createPolicy({ maxAttempts: 3 });

    expect(
      policy.decide({
        ...DEFAULT_CONTEXT,
        attempt: 3,
        rateLimited: true,
        retryAfterMs: 1_000,
      })
    ).toEqual({ kind: "fail", reason: "attempts_exhausted" });
  });

  it("applies deterministic symmetric jitter around an uncapped delay", () => {
    const lowPolicy = createPolicy({ jitterRatio: 0.25 }, () => 0);
    const middlePolicy = createPolicy({ jitterRatio: 0.25 }, () => 0.5);
    const highPolicy = createPolicy({ jitterRatio: 0.25 }, () => 0.999);

    expect(lowPolicy.decide({ ...DEFAULT_CONTEXT, attempt: 2 })).toEqual({
      kind: "retry",
      delayMs: 150,
    });
    expect(middlePolicy.decide({ ...DEFAULT_CONTEXT, attempt: 2 })).toEqual({
      kind: "retry",
      delayMs: 200,
    });
    expect(highPolicy.decide({ ...DEFAULT_CONTEXT, attempt: 2 })).toEqual({
      kind: "retry",
      delayMs: 250,
    });
  });

  it("retains a hard maximum after exponential growth and positive jitter", () => {
    const policy = createPolicy(
      {
        maxAttempts: Number.MAX_SAFE_INTEGER,
        baseDelayMs: 400,
        maxDelayMs: 1_000,
        jitterRatio: 0.5,
      },
      () => 0.999
    );

    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: Number.MAX_SAFE_INTEGER - 1 })).toEqual({
      kind: "retry",
      delayMs: 1_000,
    });
  });

  it("computes a safe capped delay without overflowing during doubling", () => {
    const policy = createPolicy({
      maxAttempts: Number.MAX_SAFE_INTEGER,
      baseDelayMs: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
      maxDelayMs: Number.MAX_SAFE_INTEGER,
      jitterRatio: 0,
    });

    expect(policy.decide({ ...DEFAULT_CONTEXT, attempt: 2 })).toEqual({
      kind: "retry",
      delayMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it("accepts zero and maximum-safe provider retry delays without changing them", () => {
    const policy = createPolicy();

    expect(policy.decide({ ...DEFAULT_CONTEXT, rateLimited: true, retryAfterMs: 0 })).toEqual({
      kind: "pause",
      reason: "rate_limit",
      retryAfterMs: 0,
    });
    expect(
      policy.decide({
        ...DEFAULT_CONTEXT,
        rateLimited: true,
        retryAfterMs: Number.MAX_SAFE_INTEGER,
      })
    ).toEqual({
      kind: "pause",
      reason: "rate_limit",
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each([
    ["maxAttempts", { maxAttempts: 0 }],
    ["maxAttempts", { maxAttempts: 1.5 }],
    ["maxAttempts", { maxAttempts: Number.MAX_SAFE_INTEGER + 1 }],
    ["baseDelayMs", { baseDelayMs: 0 }],
    ["baseDelayMs", { baseDelayMs: Number.POSITIVE_INFINITY }],
    ["maxDelayMs", { maxDelayMs: -1 }],
    ["maxDelayMs", { maxDelayMs: 50 }],
    ["jitterRatio", { jitterRatio: -0.01 }],
    ["jitterRatio", { jitterRatio: 1.01 }],
    ["jitterRatio", { jitterRatio: Number.NaN }],
  ] as const)("rejects invalid %s configuration", (field, overrides) => {
    expect(() => createPolicy(overrides)).toThrow(RetryPolicyConfigurationError);

    try {
      createPolicy(overrides);
    } catch (error) {
      expect(error).toMatchObject({ field });
    }
  });

  it("rejects a non-function random dependency at runtime", () => {
    const error = captureError(
      () => new ExponentialRetryPolicy(DEFAULT_CONFIG, undefined as unknown as () => number)
    );

    expect(error).toBeInstanceOf(RetryPolicyConfigurationError);
    expect(error).toMatchObject({ field: "random" });
  });

  it.each([
    ["zero attempt", { attempt: 0 }, "attempt"],
    ["fractional attempt", { attempt: 1.5 }, "attempt"],
    ["unsafe attempt", { attempt: Number.MAX_SAFE_INTEGER + 1 }, "attempt"],
    ["non-boolean retryable", { retryable: "yes" }, "retryable"],
    ["non-boolean rateLimited", { rateLimited: 1 }, "rateLimited"],
    ["negative retryAfterMs", { rateLimited: true, retryAfterMs: -1 }, "retryAfterMs"],
    ["fractional retryAfterMs", { rateLimited: true, retryAfterMs: 1.5 }, "retryAfterMs"],
    [
      "unsafe retryAfterMs",
      { rateLimited: true, retryAfterMs: Number.MAX_SAFE_INTEGER + 1 },
      "retryAfterMs",
    ],
    ["retryAfterMs without rate limit", { retryAfterMs: 1_000 }, "retryAfterMs"],
  ] as const)("rejects %s", (_name, overrides, field) => {
    const policy = createPolicy();
    const context = { ...DEFAULT_CONTEXT, ...overrides } as RetryContext;

    expect(() => policy.decide(context)).toThrow(RetryPolicyContextError);

    try {
      policy.decide(context);
    } catch (error) {
      expect(error).toMatchObject({ field });
    }
  });

  it.each([-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an out-of-contract random sample %p",
    (sample) => {
      const policy = createPolicy({ jitterRatio: 0.2 }, () => sample);
      const error = captureError(() => policy.decide(DEFAULT_CONTEXT));

      expect(error).toBeInstanceOf(RetryPolicyContextError);
      expect(error).toMatchObject({ field: "random" });
    }
  );

  it("does not consult randomness when jitter is disabled", () => {
    const random = jest.fn(() => {
      throw new Error("random should not be called");
    });
    const policy = createPolicy({ jitterRatio: 0 }, random);

    expect(policy.decide(DEFAULT_CONTEXT)).toEqual({ kind: "retry", delayMs: 100 });
    expect(random).not.toHaveBeenCalled();
  });
});
