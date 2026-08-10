import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import type {
  ObsidianKnowledgeCompilerTargetVisitOptions,
  ObsidianKnowledgeCompilerTargetVisitPort,
  ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import {
  KnowledgeOutputObservationReaderError,
  ObsidianKnowledgeOutputObservationReader,
} from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** Creates one resolver with an inspectable strict request seam. */
function createResolver(
  implementation: (
    requests: readonly CompilerTargetRequest[],
    signal: AbortSignal,
    options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>
  ) => Promise<readonly unknown[]>
): ObsidianKnowledgeCompilerTargetVisitPort {
  return {
    async visit(
      requests: readonly CompilerTargetRequest[],
      signal: AbortSignal,
      options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
      visitor: ObsidianKnowledgeCompilerTargetVisitor
    ): Promise<void> {
      const observations = await implementation(requests, signal, options);
      for (const raw of observations) {
        const observation = raw as Readonly<CompilerTargetObservation>;
        const byteSize =
          observation.kind === "file"
            ? new TextEncoder().encode(observation.content).byteLength
            : undefined;
        await visitor(observation, byteSize);
      }
    },
  };
}

/** Requires one sanitized reader error code. */
async function expectReaderError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "KnowledgeOutputObservationReaderError",
    code,
    message: "The generated knowledge output could not be verified",
  });
}

describe("ObsidianKnowledgeOutputObservationReader", () => {
  it("reads only authorized paths and returns detached file hashes", async () => {
    const resolve = jest.fn(async (requests: readonly CompilerTargetRequest[]) => [
      {
        targetId: requests[0].targetId,
        kind: "file",
        path: "Wiki/主题.md",
        content: "# Exact\n",
      },
      {
        targetId: requests[1].targetId,
        kind: "missing",
        windowsPathKey: "wiki/missing.md",
      },
    ]);
    const reader = new ObsidianKnowledgeOutputObservationReader(createResolver(resolve));

    const result = await reader.observe(
      [
        { path: "Wiki/主题.md", contentHash: HASH_A },
        { path: "Wiki/Missing.md", contentHash: HASH_B },
      ],
      new AbortController().signal
    );

    expect(resolve).toHaveBeenCalledWith(
      [
        {
          targetId: "freshness-output-0",
          path: "Wiki/主题.md",
          intent: "write",
          access: "authorized",
        },
        {
          targetId: "freshness-output-1",
          path: "Wiki/Missing.md",
          intent: "write",
          access: "authorized",
        },
      ],
      expect.any(AbortSignal),
      { maxFileBytes: 2_000_000 }
    );
    expect(result).toEqual([
      {
        path: "Wiki/主题.md",
        kind: "file",
        contentHash: createFileContentHash("# Exact\n"),
      },
      { path: "Wiki/Missing.md", kind: "missing" },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
  });

  it("projects a case-equivalent authorized directory without reading content", async () => {
    const reader = new ObsidianKnowledgeOutputObservationReader(
      createResolver(async (requests) => [
        { targetId: requests[0].targetId, kind: "directory", path: "wiki/FOLDER" },
      ])
    );

    await expect(
      reader.observe([{ path: "Wiki/Folder", contentHash: HASH_A }], new AbortController().signal)
    ).resolves.toEqual([{ path: "Wiki/Folder", kind: "directory" }]);
  });

  it("rejects duplicate Windows paths before calling the resolver", async () => {
    const resolve = jest.fn(async () => []);
    const reader = new ObsidianKnowledgeOutputObservationReader(createResolver(resolve));

    await expectReaderError(
      reader.observe(
        [
          { path: "Wiki/Page.md", contentHash: HASH_A },
          { path: "wiki/page.md", contentHash: HASH_B },
        ],
        new AbortController().signal
      ),
      "request_invalid"
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects malformed or substituted resolver observations", async () => {
    const reader = new ObsidianKnowledgeOutputObservationReader(
      createResolver(async () => [
        {
          targetId: "wrong-target",
          kind: "file",
          path: "Wiki/Page.md",
          content: "content",
        },
      ])
    );

    await expectReaderError(
      reader.observe([{ path: "Wiki/Page.md", contentHash: HASH_A }], new AbortController().signal),
      "response_invalid"
    );
  });

  it("bounds both per-output and aggregate extracted characters", async () => {
    const perOutput = new ObsidianKnowledgeOutputObservationReader(
      createResolver(async (requests) => [
        {
          targetId: requests[0].targetId,
          kind: "file",
          path: "Wiki/Page.md",
          content: "1234",
        },
      ]),
      { maxCharactersPerOutput: 3 }
    );
    await expectReaderError(
      perOutput.observe(
        [{ path: "Wiki/Page.md", contentHash: HASH_A }],
        new AbortController().signal
      ),
      "output_too_large"
    );

    const aggregate = new ObsidianKnowledgeOutputObservationReader(
      createResolver(async (requests) =>
        requests.map((request, index) => ({
          targetId: request.targetId,
          kind: "file",
          path: index === 0 ? "Wiki/A.md" : "Wiki/B.md",
          content: "123",
        }))
      ),
      { maxCharactersPerOutput: 3, maxTotalCharacters: 5 }
    );
    await expectReaderError(
      aggregate.observe(
        [
          { path: "Wiki/A.md", contentHash: HASH_A },
          { path: "Wiki/B.md", contentHash: HASH_B },
        ],
        new AbortController().signal
      ),
      "output_too_large"
    );
  });

  it("fails before resolver I/O when already aborted", async () => {
    const resolve = jest.fn(async () => []);
    const reader = new ObsidianKnowledgeOutputObservationReader(createResolver(resolve));
    const controller = new AbortController();
    controller.abort();

    await expectReaderError(
      reader.observe([{ path: "Wiki/Page.md", contentHash: HASH_A }], controller.signal),
      "aborted"
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("does not retain or expose a lower-level resolver failure", async () => {
    const secret = new Error("sensitive path and content");
    const reader = new ObsidianKnowledgeOutputObservationReader(
      createResolver(async () => {
        throw secret;
      })
    );

    let thrown: unknown;
    try {
      await reader.observe(
        [{ path: "Wiki/Page.md", contentHash: HASH_A }],
        new AbortController().signal
      );
    } catch (error) {
      thrown = error;
    }
    expect(KnowledgeOutputObservationReaderError.inspect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: "resolver_unavailable" });
    expect(thrown).not.toHaveProperty("cause");
    expect(JSON.stringify(thrown)).not.toContain(secret.message);
  });
});
