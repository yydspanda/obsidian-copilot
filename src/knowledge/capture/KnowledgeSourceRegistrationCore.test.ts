import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { SourceRegistration } from "@/knowledge/manifest/SourceManifestRepository";
import type { SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

/** Creates one detached Manifest around the supplied entries. */
function createManifest(entries: SourceManifestEntry[] = []): SourceManifest {
  return { version: 1, bundleId: "personal", revision: 0, entries };
}

/** Creates one valid registered entry. */
function createEntry(
  sourceId: string,
  sourcePath: string,
  custody: SourceManifestEntry["custody"] = "user_managed"
): SourceManifestEntry {
  return { sourceId, sourcePath, sourceKey: toWindowsPathKey(sourcePath), custody };
}

describe("KnowledgeSourceRegistrationCore", () => {
  it("reuses an existing Windows path identity without a second write", async () => {
    const existing = createEntry("source-existing", "Sources/Note.md");
    const registerSource = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      { load: async () => createManifest([existing]), registerSource },
      { assertCurrent: () => undefined }
    );

    await expect(
      core.register(
        {
          bundleId: "personal",
          sourceRoot: "Sources",
          sourcePath: "Sources/Note.md",
          custody: "user_managed",
          existingPathPolicy: "reuse_path",
        },
        new AbortController().signal
      )
    ).resolves.toEqual({ status: "already_registered", entry: existing });
    expect(registerSource).not.toHaveBeenCalled();
  });

  it("creates a stable opaque id and preserves source-origin extensions", async () => {
    let registration: SourceRegistration | undefined;
    const registerSource = jest.fn(
      async (_bundleId: string, next: SourceRegistration): Promise<SourceManifestEntry> => {
        registration = next;
        return {
          ...createEntry(next.sourceId, next.sourcePath, next.custody),
          ...(next.extensions === undefined ? {} : { extensions: next.extensions }),
        };
      }
    );
    const core = new KnowledgeSourceRegistrationCore(
      { load: async () => createManifest(), registerSource },
      { assertCurrent: () => undefined }
    );
    const extensions = { origin: { version: 1, operation: "test" } };

    const result = await core.register(
      {
        bundleId: "personal",
        sourceRoot: "Sources",
        sourcePath: "Sources/Note.md",
        custody: "user_managed",
        extensions,
        existingPathPolicy: "exact",
      },
      new AbortController().signal
    );

    expect(result.status).toBe("registered");
    expect(registration).toBeDefined();
    if (!registration) throw new Error("Expected registration");
    expect(registration.sourceId).toMatch(/^source-[a-f0-9]{64}$/);
    expect(registration).toMatchObject({
      sourcePath: "Sources/Note.md",
      custody: "user_managed",
      extensions,
    });
  });

  it("rejects an out-of-root path before reading or writing Manifest", async () => {
    const load = jest.fn();
    const registerSource = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      { load, registerSource },
      { assertCurrent: () => undefined }
    );

    await expect(
      core.register(
        {
          bundleId: "personal",
          sourceRoot: "Sources",
          sourcePath: "Other/Note.md",
          custody: "user_managed",
          existingPathPolicy: "reuse_path",
        },
        new AbortController().signal
      )
    ).rejects.toThrow("outside its authorized root");
    expect(load).not.toHaveBeenCalled();
    expect(registerSource).not.toHaveBeenCalled();
  });

  it("stops before registration when its generation changes after load", async () => {
    let current = true;
    const registerSource = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      {
        load: async () => {
          current = false;
          return createManifest();
        },
        registerSource,
      },
      {
        assertCurrent: () => {
          if (!current) throw new Error("stale");
        },
      }
    );

    await expect(
      core.register(
        {
          bundleId: "personal",
          sourceRoot: "Sources",
          sourcePath: "Sources/Note.md",
          custody: "user_managed",
          existingPathPolicy: "reuse_path",
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(registerSource).not.toHaveBeenCalled();
  });

  it("requires exact custody, path spelling, and requested extensions for managed replays", async () => {
    const existing: SourceManifestEntry = {
      ...createEntry("source-existing", "Sources/Derived.md", "managed_copy"),
      extensions: {
        origin: { version: 1, operation: "query_writeback", digest: "expected" },
        runtimeOwned: { revision: 2 },
      },
    };
    const registerSource = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      { load: async () => createManifest([existing]), registerSource },
      { assertCurrent: () => undefined }
    );
    const baseRequest = {
      bundleId: "personal",
      sourceRoot: "Sources",
      sourcePath: "Sources/Derived.md",
      custody: "managed_copy" as const,
      extensions: {
        origin: { version: 1, operation: "query_writeback", digest: "expected" },
      },
      existingPathPolicy: "exact" as const,
    };

    await expect(core.register(baseRequest, new AbortController().signal)).resolves.toMatchObject({
      status: "already_registered",
    });
    await expect(
      core.register(
        {
          ...baseRequest,
          extensions: {
            origin: { version: 1, operation: "query_writeback", digest: "different" },
          },
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "KnowledgeSourceRegistrationMetadataConflictError" });
    await expect(
      core.register({ ...baseRequest, custody: "user_managed" }, new AbortController().signal)
    ).rejects.toMatchObject({ name: "KnowledgeSourceRegistrationMetadataConflictError" });
    expect(registerSource).not.toHaveBeenCalled();
  });

  it("notifies a durable commit before rejecting a stale post-write generation", async () => {
    let current = true;
    const onDurableRegistration = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      {
        load: async () => createManifest(),
        registerSource: async (_bundleId, registration) => {
          current = false;
          return createEntry(registration.sourceId, registration.sourcePath, registration.custody);
        },
      },
      {
        assertCurrent: () => {
          if (!current) throw new Error("stale");
        },
      }
    );

    await expect(
      core.register(
        {
          bundleId: "personal",
          sourceRoot: "Sources",
          sourcePath: "Sources/Committed.md",
          custody: "user_managed",
          existingPathPolicy: "reuse_path",
        },
        new AbortController().signal,
        onDurableRegistration
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onDurableRegistration).toHaveBeenCalledTimes(1);
  });

  it("snapshots path, policy, and extensions before an async Manifest read", async () => {
    const request = {
      bundleId: "personal",
      sourceRoot: "Sources",
      sourcePath: "Sources/Stable.md",
      custody: "managed_copy" as const,
      extensions: { origin: { digest: "stable" } },
      existingPathPolicy: "exact" as "exact" | "reuse_path",
    };
    let registration: SourceRegistration | undefined;
    const core = new KnowledgeSourceRegistrationCore(
      {
        load: async () => {
          request.sourceRoot = "Other";
          request.sourcePath = "Other/Changed.md";
          request.extensions.origin.digest = "changed";
          request.existingPathPolicy = "reuse_path";
          return createManifest();
        },
        registerSource: async (_bundleId, next) => {
          registration = next;
          return {
            ...createEntry(next.sourceId, next.sourcePath, next.custody),
            ...(next.extensions === undefined ? {} : { extensions: next.extensions }),
          };
        },
      },
      { assertCurrent: () => undefined }
    );

    await expect(core.register(request, new AbortController().signal)).resolves.toMatchObject({
      status: "registered",
    });
    expect(registration).toMatchObject({
      sourcePath: "Sources/Stable.md",
      custody: "managed_copy",
      extensions: { origin: { digest: "stable" } },
    });
  });

  it("rejects accessor-backed requests without invoking their getters", async () => {
    const load = jest.fn();
    const sourcePathGetter = jest.fn(() => "Sources/Accessor.md");
    const request = {
      bundleId: "personal",
      sourceRoot: "Sources",
      custody: "user_managed",
      existingPathPolicy: "reuse_path",
    } as Record<string, unknown>;
    Object.defineProperty(request, "sourcePath", {
      enumerable: true,
      get: sourcePathGetter,
    });
    const core = new KnowledgeSourceRegistrationCore(
      { load, registerSource: jest.fn() },
      { assertCurrent: () => undefined }
    );

    await expect(
      core.register(
        request as unknown as Parameters<KnowledgeSourceRegistrationCore["register"]>[0],
        new AbortController().signal
      )
    ).rejects.toThrow("registration input is invalid");
    expect(sourcePathGetter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects an invalid durable registration result before notifying recovery", async () => {
    const onDurableRegistration = jest.fn();
    const core = new KnowledgeSourceRegistrationCore(
      {
        load: async () => createManifest(),
        registerSource: async (_bundleId, next) => ({
          ...createEntry(next.sourceId, "Sources/Other.md", next.custody),
          ...(next.extensions === undefined ? {} : { extensions: next.extensions }),
        }),
      },
      { assertCurrent: () => undefined }
    );

    await expect(
      core.register(
        {
          bundleId: "personal",
          sourceRoot: "Sources",
          sourcePath: "Sources/Expected.md",
          custody: "managed_copy",
          extensions: { origin: { digest: "expected" } },
          existingPathPolicy: "exact",
        },
        new AbortController().signal,
        onDurableRegistration
      )
    ).rejects.toMatchObject({ name: "KnowledgeSourceRegistrationMetadataConflictError" });
    expect(onDurableRegistration).not.toHaveBeenCalled();
  });
});
