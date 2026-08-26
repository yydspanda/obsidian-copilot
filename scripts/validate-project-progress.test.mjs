import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProgressDocuments } from "./validate-project-progress.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function validDocuments() {
  return {
    tracker: {
      path: "TODO.md",
      text: `# Project Progress

## Current Stage

- Stage ID: \`PK-H3\`

## In Progress

- [ ] \`PK-H3-UPSTREAM-V4-WIN\` — Validate the current artifact.

## Recent Activity

- 2026-08-26 — \`OPS-UPSTREAM-SYNC\` — Merged upstream.
`,
    },
    roadmap: {
      path: "designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md",
      text: `# Roadmap

- Stage ID: \`PK-H3\` — Windows acceptance.
- Task ID: \`PK-H2-COMPLETE\` — Completed acceptance.
- Task ID: \`PK-H3-UPSTREAM-V4-WIN\` — Current acceptance.
- Task ID: \`OPS-UPSTREAM-SYNC\` — Recurring upstream sync.
`,
    },
    archives: [
      {
        path: "designdocs/progress/archive/2026-08.md",
        text: `# Archive

## 2026-08-26

- [x] \`PK-H2-COMPLETE\` — Completed acceptance.
- Task event: \`OPS-UPSTREAM-SYNC\` — Recurring upstream sync.
`,
      },
    ],
    experiments: [
      {
        path: "designdocs/progress/experiments/2026-08.md",
        text: `# Experiments

## Experiment \`EXP-20260826-001\`

- Task ID: \`PK-H3-UPSTREAM-V4-WIN\`
- Upstream commit: \`0123456789abcdef0123456789abcdef01234567\`
- Model: \`none\`
- Model config hash: \`${HASH_A}\`
- Data hash: \`${HASH_B}\`
- Hardware: \`Windows 11; CPU; 32 GB RAM; GPU none\`
- Command: \`npm test\`
- Metrics: \`tests=20 count; failures=0 count\`
`,
      },
    ],
    limits: { maxTrackerLines: 40, maxRecentActivity: 10 },
  };
}

describe("validate-project-progress", () => {
  describe("validateProgressDocuments()", () => {
    it("accepts one registered stage, one active task, monthly completion, and complete experiment evidence (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      assert.deepEqual(validateProgressDocuments(validDocuments()), []);
    });

    it("rejects missing or duplicate Current Stage and In Progress control points (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const missing = validDocuments();
      missing.tracker.text = missing.tracker.text
        .replace("## Current Stage\n\n- Stage ID: `PK-H3`\n\n", "")
        .replace("## In Progress", "## Queued");
      const missingErrors = validateProgressDocuments(missing);
      assert(missingErrors.some((error) => error.includes("exactly one `## Current Stage`")));
      assert(missingErrors.some((error) => error.includes("exactly one `## In Progress`")));

      const duplicate = validDocuments();
      duplicate.tracker.text += "\n## Current Stage\n\n- Stage ID: `PK-H3`\n";
      duplicate.tracker.text += "\n## In Progress\n\n- [ ] `OPS-UPSTREAM-SYNC` — Duplicate.\n";
      const duplicateErrors = validateProgressDocuments(duplicate);
      assert(duplicateErrors.some((error) => error.includes("exactly one `## Current Stage`")));
      assert(duplicateErrors.some((error) => error.includes("exactly one unchecked task")));
    });

    it("rejects invalid and unregistered Current Stage IDs (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const invalid = validDocuments();
      invalid.tracker.text = invalid.tracker.text.replace("`PK-H3`", "`pk-h3`");
      const invalidErrors = validateProgressDocuments(invalid);
      assert(
        invalidErrors.some(
          (error) => error.includes("Current Stage ID") && error.includes("invalid")
        )
      );

      const unregistered = validDocuments();
      unregistered.tracker.text = unregistered.tracker.text.replace("`PK-H3`", "`PK-H4`");
      const unregisteredErrors = validateProgressDocuments(unregistered);
      assert(
        unregisteredErrors.some(
          (error) =>
            error.includes("Current Stage") && error.includes("not registered as a Stage ID")
        )
      );
    });

    it("rejects a Stage ID used as an active or experimental Task ID (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const active = validDocuments();
      active.tracker.text = active.tracker.text.replace("`PK-H3-UPSTREAM-V4-WIN`", "`PK-H3`");
      const activeErrors = validateProgressDocuments(active);
      assert(
        activeErrors.some(
          (error) => error.includes("in-progress") && error.includes("not registered as a Task ID")
        )
      );

      const experimental = validDocuments();
      experimental.experiments[0].text = experimental.experiments[0].text.replace(
        "`PK-H3-UPSTREAM-V4-WIN`",
        "`PK-H3`"
      );
      const experimentalErrors = validateProgressDocuments(experimental);
      assert(
        experimentalErrors.some(
          (error) => error.includes("experiment") && error.includes("unknown Task ID `PK-H3`")
        )
      );
    });

    it("rejects completed live tasks, extra active tasks, and tracker growth past configured limits (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.tracker.text = documents.tracker.text
        .replace(
          "- [ ] `PK-H3-UPSTREAM-V4-WIN` — Validate the current artifact.",
          "- [ ] `PK-H3-UPSTREAM-V4-WIN` — Validate the current artifact.\n- [ ] `OPS-UPSTREAM-SYNC` — Extra task.\n- [x] `OPS-UPSTREAM-SYNC` — Completed here."
        )
        .concat("\n", "filler\n".repeat(50));
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("exactly one unchecked task")));
      assert(errors.some((error) => error.includes("completed checkboxes belong")));
      assert(errors.some((error) => error.includes("exceeds the live-tracker limit")));
    });

    it("rejects indented unchecked tasks in the live tracker and monthly archive (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.tracker.text = documents.tracker.text.replace(
        "- [ ] `PK-H3-UPSTREAM-V4-WIN` — Validate the current artifact.",
        "- [ ] `PK-H3-UPSTREAM-V4-WIN` — Validate the current artifact.\n  - [ ] `OPS-UPSTREAM-SYNC` — Hidden extra task."
      );
      documents.archives[0].text +=
        "\n  - [ ] `OPS-UPSTREAM-SYNC` — Pending work cannot be archived.\n";
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("exactly one unchecked task")));
      assert(errors.some((error) => error.includes("archives cannot contain unchecked tasks")));
    });

    it("rejects malformed Recent Activity bullets and counts them toward the configured limit (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      const records = Array.from(
        { length: 10 },
        (_, index) =>
          `- 2026-08-${String(index + 1).padStart(2, "0")} — \`OPS-UPSTREAM-SYNC\` — Event.`
      );
      records.push("- malformed activity without a date or Task ID");
      documents.tracker.text = documents.tracker.text.replace(
        "- 2026-08-26 — `OPS-UPSTREAM-SYNC` — Merged upstream.",
        records.join("\n")
      );
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("11 recent records exceeds")));
      assert(
        errors.some(
          (error) =>
            error.includes("recent record") && error.includes("date") && error.includes("Task ID")
        )
      );
    });

    it("rejects unknown references and duplicate roadmap registrations (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.tracker.text = documents.tracker.text.replace(
        "`PK-H3-UPSTREAM-V4-WIN`",
        "`PK-H3-UNKNOWN`"
      );
      documents.roadmap.text +=
        "- Task ID: `OPS-UPSTREAM-SYNC` — Duplicate.\n- Task ID: `bad-id` — Invalid.\n";
      documents.archives[0].text = documents.archives[0].text.replace(
        "Task event: `OPS-UPSTREAM-SYNC`",
        "Task event: `PK-H3-UNKNOWN`"
      );
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("not registered") && error.includes("roadmap")));
      assert(errors.some((error) => error.includes("Task event ID `PK-H3-UNKNOWN`")));
      assert(errors.some((error) => error.includes("duplicate registered ID")));
      assert(errors.some((error) => error.includes("invalid registered ID")));
    });

    it("allows normal backticked technical tokens in tracker and archive prose (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.tracker.text += "\n## Notes\n\n- Artifact hashes use `SHA-256`.\n";
      documents.archives[0].text += "\nArtifact hashes use `SHA-256`.\n";
      assert.deepEqual(validateProgressDocuments(documents), []);
    });

    it("rejects pending archive work, malformed archive names, and completion dates outside the file month (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.archives = [
        {
          path: "designdocs/progress/archive/August.md",
          text: "## 2026-07-31\n\n- [ ] pending\n",
        },
        {
          path: "designdocs/progress/archive/2026-08.md",
          text: "## 2026-07-31\n\n- [ ] pending\n- Task event: missing-id\n",
        },
      ];
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("filename must be YYYY-MM.md")));
      assert(errors.some((error) => error.includes("cannot contain unchecked tasks")));
      assert(errors.some((error) => error.includes("does not match filename")));
      assert(errors.some((error) => error.includes("Task event must start")));
    });

    it("rejects every omitted required experiment field (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const requiredFields = [
        "Task ID",
        "Upstream commit",
        "Model",
        "Model config hash",
        "Data hash",
        "Hardware",
        "Command",
        "Metrics",
      ];

      for (const field of requiredFields) {
        const documents = validDocuments();
        documents.experiments[0].text = documents.experiments[0].text
          .split("\n")
          .filter((line) => !line.startsWith(`- ${field}: `))
          .join("\n");
        const errors = validateProgressDocuments(documents);
        assert(
          errors.some((error) => error.includes(`requires exactly one ${field} field`)),
          `expected missing ${field} to fail`
        );
      }
    });

    it("does not borrow a missing experiment field from a later H2 section (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.experiments[0].text = documents.experiments[0].text.replace(
        "- Metrics: `tests=20 count; failures=0 count`",
        "## Notes\n\n- Metrics: `tests=20 count; failures=0 count`"
      );
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("requires exactly one Metrics field")));
    });

    it("rejects a malformed experiment-like H2 after a valid experiment (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      documents.experiments[0].text += "\n## Experiment EXP-20260826-002\n";
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("experiment") && error.includes("heading")));
    });

    it("rejects malformed experiment identity, commit and hashes, unknown tasks, and duplicate IDs (https://github.com/yydspanda/obsidian-copilot/issues/1)", () => {
      const documents = validDocuments();
      const malformed = documents.experiments[0].text
        .replace("EXP-20260826-001", "EXP-20260726-001")
        .replace("PK-H3-UPSTREAM-V4-WIN", "PK-H3-UNKNOWN")
        .replace("0123456789abcdef0123456789abcdef01234567", "short")
        .replace(HASH_A, "sha256:bad")
        .replace(HASH_B, "sha256:also-bad");
      documents.experiments[0].text = `${malformed}\n${malformed.replace(
        "EXP-20260726-001",
        "EXP-20260726-001"
      )}`;
      const errors = validateProgressDocuments(documents);
      assert(errors.some((error) => error.includes("does not match the log month")));
      assert(errors.some((error) => error.includes("duplicate experiment ID")));
      assert(errors.some((error) => error.includes("unknown Task ID")));
      assert(errors.some((error) => error.includes("invalid upstream commit")));
      assert(errors.some((error) => error.includes("invalid model config hash")));
      assert(errors.some((error) => error.includes("invalid data hash")));
    });
  });
});
