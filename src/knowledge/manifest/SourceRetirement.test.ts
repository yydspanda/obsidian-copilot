import {
  KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY,
  createKnowledgeSourceRetirementRecord,
  findKnowledgeSourceHistoryEntry,
  parseKnowledgeSourceRetirements,
  projectKnowledgeSourceRetirement,
} from "@/knowledge/manifest/SourceRetirement";
import type { JsonValue, SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { validateSourceManifest } from "@/knowledge/model/validation";

const REQUEST_TOKEN = "a".repeat(64);

/** Creates one strict active source fixture. */
function createSource(): SourceManifestEntry {
  return {
    sourceId: "source-1",
    sourceKey: "sources/note.md",
    sourcePath: "Sources/Note.md",
    custody: "user_managed",
  };
}

/** Creates one strict active Manifest fixture. */
function createManifest(source = createSource()): SourceManifest {
  return {
    version: 1,
    bundleId: "personal",
    revision: 1,
    entries: [source],
  };
}

describe("SourceRetirement", () => {
  it("moves the complete source into strict history while leaving active entries empty", () => {
    const manifest = createManifest();
    const record = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: REQUEST_TOKEN,
      reason: "user_requested",
      retiredAt: 100,
      retiredManifestRevision: 2,
      source: manifest.entries[0],
    });

    const retired = projectKnowledgeSourceRetirement(manifest, record);
    const parsed = parseKnowledgeSourceRetirements(retired);

    expect(retired.revision).toBe(2);
    expect(retired.entries).toEqual([]);
    expect(validateSourceManifest(retired).valid).toBe(true);
    expect(parsed).toEqual({ ok: true, value: [record] });
    expect(findKnowledgeSourceHistoryEntry(retired, "source-1")).toEqual(manifest.entries[0]);
  });

  it("rejects a tombstone whose content-addressed identity was changed", () => {
    const manifest = createManifest();
    const record = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: REQUEST_TOKEN,
      reason: "source_missing",
      retiredAt: 100,
      retiredManifestRevision: 2,
      source: manifest.entries[0],
    });
    const retired = projectKnowledgeSourceRetirement(manifest, record);
    const tampered: SourceManifest = {
      ...retired,
      extensions: {
        ...retired.extensions,
        [KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY]: [
          { ...record, retirementId: `knowledge-source-retirement-${"b".repeat(64)}` },
        ] as unknown as JsonValue,
      },
    };

    expect(parseKnowledgeSourceRetirements(tampered).ok).toBe(false);
    expect(validateSourceManifest(tampered).valid).toBe(false);
  });

  it("rejects active identities that overlap protected retirement history", () => {
    const manifest = createManifest();
    const record = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: REQUEST_TOKEN,
      reason: "user_requested",
      retiredAt: 100,
      retiredManifestRevision: 2,
      source: manifest.entries[0],
    });
    const retired = projectKnowledgeSourceRetirement(manifest, record);
    const resurrected: SourceManifest = {
      ...retired,
      revision: 3,
      entries: [manifest.entries[0]],
    };

    expect(parseKnowledgeSourceRetirements(resurrected).ok).toBe(true);
    const validation = validateSourceManifest(resurrected);
    expect(validation.valid).toBe(false);
    const codes = validation.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("source_retirement_id_duplicate");
    expect(codes).toContain("source_retirement_key_duplicate");
  });

  it("refuses a projection that no longer matches the active Manifest revision", () => {
    const manifest = createManifest();
    const record = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: REQUEST_TOKEN,
      reason: "user_requested",
      retiredAt: 100,
      retiredManifestRevision: 3,
      source: manifest.entries[0],
    });

    expect(() => projectKnowledgeSourceRetirement(manifest, record)).toThrow(
      "Source retirement no longer matches the active Manifest"
    );
  });

  it("requires a positive retirement revision", () => {
    expect(() =>
      createKnowledgeSourceRetirementRecord({
        bundleId: "personal",
        requestToken: REQUEST_TOKEN,
        reason: "user_requested",
        retiredAt: 100,
        retiredManifestRevision: 0,
        source: createSource(),
      })
    ).toThrow("strict contract");
  });

  it("rejects non-increasing history and reused request tokens", () => {
    const first = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: REQUEST_TOKEN,
      reason: "user_requested",
      retiredAt: 100,
      retiredManifestRevision: 2,
      source: createSource(),
    });
    const secondSource: SourceManifestEntry = {
      sourceId: "source-2",
      sourceKey: "sources/second.md",
      sourcePath: "Sources/Second.md",
      custody: "managed_copy",
    };
    const second = createKnowledgeSourceRetirementRecord({
      bundleId: "personal",
      requestToken: "b".repeat(64),
      reason: "source_missing",
      retiredAt: 101,
      retiredManifestRevision: 3,
      source: secondSource,
    });
    const extension = (records: unknown[]): SourceManifest => ({
      version: 1,
      bundleId: "personal",
      revision: 3,
      entries: [],
      extensions: {
        [KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY]: records as JsonValue,
      },
    });

    expect(parseKnowledgeSourceRetirements(extension([second, first])).ok).toBe(false);
    const duplicateRevision = createKnowledgeSourceRetirementRecord({
      ...second,
      requestToken: "c".repeat(64),
      retiredManifestRevision: 2,
      source: secondSource,
    });
    expect(parseKnowledgeSourceRetirements(extension([first, duplicateRevision])).ok).toBe(false);
    const reusedToken = createKnowledgeSourceRetirementRecord({
      ...second,
      requestToken: REQUEST_TOKEN,
      source: secondSource,
    });
    expect(parseKnowledgeSourceRetirements(extension([first, reusedToken])).ok).toBe(false);
  });
});
