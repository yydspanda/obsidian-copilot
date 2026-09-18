import { App, Stat, TFile } from "obsidian";

import { ObsidianExactSourceArtifactReader } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import * as fingerprint from "@/knowledge/model/fingerprint";
import {
  KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS,
  KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS,
} from "@/knowledge/startup/KnowledgeProductionPipelineResources";

jest.mock("obsidian", () => ({ TFile: class TFile {} }));

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/11";

function createHarness(maxBytes = 4) {
  const file = Object.assign(new TFile(), {
    path: "Sources/input.md",
    stat: { size: 1, ctime: 1, mtime: 1 },
  });
  const payload = Uint8Array.of(1, 2, 3, 4).buffer;
  const stat = jest.fn(
    async (): Promise<Stat | null> => ({
      type: "file",
      size: 4,
      ctime: 1,
      mtime: 1,
    })
  );
  const readBinary = jest.fn(async () => payload);
  const app = {
    vault: { adapter: { stat, readBinary }, getAbstractFileByPath: () => file },
  } as unknown as App;
  return {
    file,
    payload,
    stat,
    readBinary,
    app,
    reader: new ObsidianExactSourceArtifactReader(app, maxBytes),
  };
}

describe("ObsidianVaultSourceWatcher", () => {
  describe("ObsidianExactSourceArtifactReader", () => {
    afterEach(() => jest.restoreAllMocks());

    describe("constructor()", () => {
      it.each([0, -1, 1.5, NaN, Infinity])(
        `rejects invalid byte budget %s instead of silently disabling the bound (${ISSUE})`,
        (maxBytes) => {
          expect(() => createHarness(maxBytes)).toThrow(TypeError);
        }
      );
    });

    describe("read()", () => {
      it(`allows the exact byte boundary and returns a detached, correctly hashed snapshot (${ISSUE})`, async () => {
        const harness = createHarness();
        const artifact = await harness.reader.read(harness.file.path);

        expect([...artifact.bytes]).toEqual([1, 2, 3, 4]);
        expect(artifact.sourceContentHash).toBe(
          fingerprint.createSourceContentHash(harness.payload)
        );
        new Uint8Array(harness.payload)[0] = 99;
        expect(artifact.bytes[0]).toBe(1);
        expect(harness.stat).toHaveBeenCalledWith(harness.file.path);
      });

      it.each(["Sources/input.md", "Sources/input.pdf"])(
        `rejects an oversized replacement at the production parser budget before reading %s (${ISSUE})`,
        async (path) => {
          const harness = createHarness();
          harness.file.path = path;
          harness.stat.mockResolvedValue({
            type: "file",
            size: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxBytes + 1,
            ctime: 1,
            mtime: 1,
          });
          const reader = new ObsidianExactSourceArtifactReader(harness.app);

          expect(KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxBytes).toBe(
            KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxBytes
          );
          await expect(reader.read(path)).rejects.toMatchObject({
            name: "SourceArtifactSizeLimitError",
          });
          expect(harness.readBinary).not.toHaveBeenCalled();
        }
      );

      it(`rejects growth between stat and read before copying or hashing the returned bytes (${ISSUE})`, async () => {
        const harness = createHarness();
        const grown = Uint8Array.of(1, 2, 3, 4, 5).buffer;
        // ArrayBuffer properties must not override its actual internal byte length.
        Object.defineProperty(grown, "byteLength", { value: 1 });
        harness.readBinary.mockResolvedValue(grown);
        const hash = jest.spyOn(fingerprint, "createSourceContentHash");

        await expect(harness.reader.read(harness.file.path)).rejects.toMatchObject({
          name: "SourceArtifactSizeLimitError",
        });
        expect(harness.readBinary).toHaveBeenCalledTimes(1);
        expect(hash).not.toHaveBeenCalled();
      });

      it.each([-1, 0.5, NaN, Infinity])(
        `rejects an invalid fresh byte size %s before reading (${ISSUE})`,
        async (size) => {
          const harness = createHarness();
          harness.stat.mockResolvedValue({ type: "file", size, ctime: 1, mtime: 1 });

          await expect(harness.reader.read(harness.file.path)).rejects.toMatchObject({
            name: "SourceArtifactAdapterPayloadError",
          });
          expect(harness.readBinary).not.toHaveBeenCalled();
        }
      );

      it.each([null, { type: "folder", size: 0, ctime: 1, mtime: 1 }] as const)(
        `does not read a cached source that is now missing or a folder (%j) (${ISSUE})`,
        async (stat) => {
          const harness = createHarness();
          harness.stat.mockResolvedValue(stat);

          await expect(harness.reader.read(harness.file.path)).rejects.toMatchObject({
            name: "SourceArtifactUnavailableError",
          });
          expect(harness.readBinary).not.toHaveBeenCalled();
        }
      );

      it(`does not begin a binary read when cancellation arrives during the fresh stat (${ISSUE})`, async () => {
        const harness = createHarness();
        const controller = new AbortController();
        harness.stat.mockImplementation(async () => {
          controller.abort();
          return { type: "file", size: 4, ctime: 1, mtime: 1 };
        });

        await expect(
          harness.reader.read(harness.file.path, controller.signal)
        ).rejects.toMatchObject({
          name: "AbortError",
        });
        expect(harness.readBinary).not.toHaveBeenCalled();
      });
    });

    describe("readExpected()", () => {
      it(`enforces the same bound for compiler re-reads before hash matching (${ISSUE})`, async () => {
        const harness = createHarness();
        harness.stat.mockResolvedValue({ type: "file", size: 5, ctime: 1, mtime: 1 });

        await expect(
          harness.reader.readExpected(harness.file.path, "a".repeat(64))
        ).rejects.toMatchObject({ name: "SourceArtifactSizeLimitError" });
        expect(harness.readBinary).not.toHaveBeenCalled();
      });
    });
  });
});
