import type {
  CompilerTargetAuthorization,
  KnowledgeCompileInput,
} from "@/knowledge/compiler/CompilerModelPort";
import { createKnowledgeSourceTargetPlan } from "@/knowledge/compiler/KnowledgeSourceTargetPlan";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/20";

function createInput(
  authorizations: CompilerTargetAuthorization[] = [],
  sourcePath = "Reading/第十三章.pdf"
): KnowledgeCompileInput {
  const content = "Consider observations under different conditions.";
  const contentHash = createFileContentHash(content);
  return {
    bundle: {
      version: 1,
      id: "reading-project",
      sourceRoots: ["Reading"],
      wikiRoot: "Personal Knowledge/Reading Notes",
      schemaRef: "Config/Rules.md",
      reviewMode: "always",
    },
    operation: "ingest",
    source: {
      sourceId: "source-chapter-13",
      sourceContentHash: contentHash,
      pipelineFingerprint: "b".repeat(64),
      inputRevision: 1,
    },
    manifest: {
      version: 1,
      bundleId: "reading-project",
      revision: 0,
      entries: [
        {
          sourceId: "source-chapter-13",
          sourceKey: toWindowsPathKey(sourcePath),
          sourcePath,
          custody: "user_managed",
        },
      ],
    },
    schema: {
      path: "Config/Rules.md",
      content: "Organize source-backed reading notes.",
      contentHash: createFileContentHash("Organize source-backed reading notes."),
    },
    artifacts: [
      {
        kind: "text",
        sourceId: "source-chapter-13",
        artifactId: "artifact-main",
        artifactContentHash: contentHash,
        text: content,
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-main",
        locator: {
          kind: "quote",
          sourceId: "source-chapter-13",
          artifactId: "artifact-main",
          artifactContentHash: contentHash,
          excerpt: content,
          quoteHash: createQuoteHash(content),
        },
      },
    ],
    contextPages: [],
    targetAuthorizations: authorizations,
    createdAt: 1,
  };
}

function createAuthorization(
  name: string,
  overrides: Partial<CompilerTargetAuthorization> = {}
): CompilerTargetAuthorization {
  return {
    path: `Personal Knowledge/Reading Notes/${name}.md`,
    allowedIntents: ["write"],
    contentPolicy: "grounded",
    ownership: "generated",
    sourceRefs: ["source-chapter-13"],
    expectedContentHash: "c".repeat(64),
    ...overrides,
  };
}

describe("KnowledgeSourceTargetPlan", () => {
  describe("createKnowledgeSourceTargetPlan()", () => {
    it(`assigns a readable stable Markdown destination for a new source without choosing claims (${ISSUE})`, () => {
      const input = createInput();
      const [target] = createKnowledgeSourceTargetPlan(input);

      expect(target).toMatchObject({
        path: `Personal Knowledge/Reading Notes/第十三章-${sha256(input.source.sourceId).slice(0, 12)}.md`,
        intent: "write",
        reason: "Organize the complete source material.",
        claimRefs: [],
      });
      expect(typeof target.ref).toBe("string");
      expect(parseVaultPath(target.path).ok).toBe(true);
      expect(createKnowledgeSourceTargetPlan(input)).toEqual([target]);
    });

    it(`retains every explicitly writable grounded existing page in stable path order without consolidating or deleting (${ISSUE})`, () => {
      const input = createInput([
        createAuthorization("z-user", { ownership: "user" }),
        createAuthorization("a-shared", {
          ownership: "shared",
          sourceRefs: ["source-chapter-13", "source-chapter-10"],
        }),
        createAuthorization("m-generated", { allowedIntents: ["write", "delete"] }),
      ]);
      const before = JSON.stringify(input);

      const targets = createKnowledgeSourceTargetPlan(input);

      expect(targets.map((target) => target.path)).toEqual([
        "Personal Knowledge/Reading Notes/a-shared.md",
        "Personal Knowledge/Reading Notes/m-generated.md",
        "Personal Knowledge/Reading Notes/z-user.md",
      ]);
      expect(targets.every((target) => target.intent === "write")).toBe(true);
      expect(targets.every((target) => target.claimRefs.length === 0)).toBe(true);
      expect(new Set(targets.map((target) => target.ref)).size).toBe(3);
      expect(JSON.stringify(input)).toBe(before);
      expect(
        createKnowledgeSourceTargetPlan({
          ...input,
          targetAuthorizations: [...input.targetAuthorizations].reverse(),
        })
      ).toEqual(targets);
    });

    it(`does not treat delete-only or structural authority as permission to rewrite source content (${ISSUE})`, () => {
      const input = createInput([
        createAuthorization("read-only", { allowedIntents: ["delete"] }),
        createAuthorization("index", { contentPolicy: "structural" }),
        createAuthorization("summary"),
      ]);

      expect(createKnowledgeSourceTargetPlan(input).map((target) => target.path)).toEqual([
        "Personal Knowledge/Reading Notes/summary.md",
      ]);
    });

    it(`plans a new destination when existing pages grant no grounded write authority (${ISSUE})`, () => {
      const input = createInput([
        createAuthorization("index", { contentPolicy: "structural" }),
        createAuthorization("old", { allowedIntents: ["delete"] }),
      ]);

      expect(createKnowledgeSourceTargetPlan(input)).toEqual(
        createKnowledgeSourceTargetPlan(createInput())
      );
    });

    it(`keeps an occupied or denied deterministic candidate unchanged for the resolver to reject rather than inventing retries (${ISSUE})`, () => {
      const input = createInput();
      const target = createKnowledgeSourceTargetPlan(input)[0];
      input.targetAuthorizations = [
        createAuthorization("denied", {
          path: target.path,
          allowedIntents: ["delete"],
        }),
      ];

      expect(createKnowledgeSourceTargetPlan(input)).toEqual([target]);
    });

    it(`routes independently of source wording, evidence selection, hashes, or retry revision (${ISSUE})`, () => {
      const input = createInput();
      const expected = createKnowledgeSourceTargetPlan(input);
      const revised = createInput();
      const revisedText = "An added personal reflection with counterexamples.";
      const revisedHash = createFileContentHash(revisedText);
      revised.source.sourceContentHash = revisedHash;
      revised.source.inputRevision += 1;
      revised.evidence[0].locator.excerpt = revisedText;
      revised.evidence[0].locator.artifactContentHash = revisedHash;
      revised.evidence[0].locator.quoteHash = createQuoteHash(revised.evidence[0].locator.excerpt);
      revised.artifacts = [
        {
          kind: "text",
          sourceId: revised.source.sourceId,
          artifactId: "artifact-main",
          artifactContentHash: revisedHash,
          text: revisedText,
        },
      ];
      revised.createdAt += 1;

      expect(createKnowledgeSourceTargetPlan(revised)).toEqual(expected);
    });

    it(`separates different sources with the same basename by stable source identity (${ISSUE})`, () => {
      const original = createInput();
      const another = createInput();
      another.source.sourceId = "another-source";
      another.manifest.entries[0].sourceId = another.source.sourceId;

      expect(createKnowledgeSourceTargetPlan(another)[0].path).not.toBe(
        createKnowledgeSourceTargetPlan(original)[0].path
      );
    });

    it.each(["Reading/notes", "Reading/archive.part.md", "Reading/.md"])(
      `creates a valid Markdown destination for source name %s (${ISSUE})`,
      (sourcePath) => {
        const [target] = createKnowledgeSourceTargetPlan(createInput([], sourcePath));

        expect(parseVaultPath(target.path).ok).toBe(true);
        expect(target.path).toMatch(/-[a-f0-9]{12}\.md$/);
        expect(target.path.split("/")).toHaveLength(3);
      }
    );

    it(`bounds long multibyte basenames while retaining the complete identity suffix and valid Unicode (${ISSUE})`, () => {
      const input = createInput([], `Reading/${"📚".repeat(200)}.md`);
      const [target] = createKnowledgeSourceTargetPlan(input);
      const basename = target.path.split("/").pop()!;

      expect(new TextEncoder().encode(basename).byteLength).toBeLessThanOrEqual(255);
      expect(target.path).toMatch(
        new RegExp(`-${sha256(input.source.sourceId).slice(0, 12)}\\.md$`)
      );
      expect(new TextDecoder().decode(new TextEncoder().encode(basename))).toBe(basename);
      expect(parseVaultPath(target.path).ok).toBe(true);
    });
  });
});
