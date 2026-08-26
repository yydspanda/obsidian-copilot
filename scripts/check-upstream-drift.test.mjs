import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateUpstreamDrift } from "./check-upstream-drift.mjs";

function observation(overrides = {}) {
  return {
    ahead: 4,
    behind: 0,
    oldestMissingAgeDays: null,
    maxBehind: 10,
    maxAgeDays: 7,
    ...overrides,
  };
}

describe("check-upstream-drift", () => {
  describe("evaluateUpstreamDrift()", () => {
    it("passes an aligned branch regardless of its ahead count (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      assert.deepEqual(evaluateUpstreamDrift(observation()), { level: "pass", reasons: [] });
    });

    it("warns as soon as canonical upstream has an unmerged commit (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      assert.deepEqual(
        evaluateUpstreamDrift(observation({ behind: 1, oldestMissingAgeDays: 0.5 })),
        { level: "warn", reasons: ["behind 1 commit(s)"] }
      );
    });

    it("fails before drift reaches dozens of commits (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const result = evaluateUpstreamDrift(observation({ behind: 10, oldestMissingAgeDays: 1 }));
      assert.equal(result.level, "fail");
      assert(result.reasons.some((reason) => reason.includes("behind 10 commits")));
    });

    it("fails when even a small missing set remains unmerged past the age limit (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const result = evaluateUpstreamDrift(observation({ behind: 2, oldestMissingAgeDays: 7.01 }));
      assert.equal(result.level, "fail");
      assert(result.reasons.some((reason) => reason.includes("7.01 days old")));
    });

    it("keeps the exact commit and age boundaries non-failing (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      assert.equal(
        evaluateUpstreamDrift(observation({ behind: 9, oldestMissingAgeDays: 7 })).level,
        "warn"
      );
    });

    it("rejects invalid or incomplete observations instead of reporting false alignment (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      assert.throws(
        () => evaluateUpstreamDrift(observation({ behind: 1, oldestMissingAgeDays: null })),
        /must include/
      );
      assert.throws(() => evaluateUpstreamDrift(observation({ behind: -1 })), /behind/);
      assert.throws(
        () => evaluateUpstreamDrift(observation({ maxBehind: 0 })),
        /greater than zero/
      );
    });
  });
});
