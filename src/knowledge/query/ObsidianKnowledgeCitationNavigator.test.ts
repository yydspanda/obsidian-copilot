jest.mock("obsidian", () => ({
  TFile: class TestTFile {
    path: string;
    extension: string;

    /** Creates a minimal runtime TFile for navigator tests. */
    constructor(path: string) {
      this.path = path;
      this.extension = path.split(".").pop() ?? "";
    }
  },
  MarkdownView: class TestMarkdownView {},
}));

import {
  MarkdownView,
  TFile,
  type App,
  type Editor,
  type Vault,
  type Workspace,
  type WorkspaceLeaf,
} from "obsidian";

import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";

import { ObsidianKnowledgeCitationNavigator } from "./ObsidianKnowledgeCitationNavigator";

const SOURCE_PATH = "Sources/Research.md";
const PDF_SOURCE_PATH = "Sources/研究 Paper.pdf";

/** Creates detached exact bytes for one fake Vault binary read. */
function createBinary(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

/** Promise whose completion is explicitly controlled by one navigation test. */
function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Flushes work scheduled behind the shared App navigation queue. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Creates one fake TFile despite Obsidian's opaque public constructor. */
function createTestFile(path: string): TFile {
  const Constructor = TFile as unknown as new (value: string) => TFile;
  return new Constructor(path);
}

/** Creates one fake MarkdownView with an exact file and editor owner. */
function createTestMarkdownView(file: TFile, editor: Editor): MarkdownView {
  const Constructor = MarkdownView as unknown as new () => MarkdownView;
  const view = new Constructor();
  Object.assign(view, { file, editor });
  return view;
}

/** Creates fields shared by exact source locator fixtures. */
function createLocatorBase(content: string, excerpt: string) {
  return {
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: createFileContentHash(content),
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
}

/** Creates one claim citation from an exact locator. */
function createCitation(locator: SourceLocator): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator,
  };
}

/** In-memory App/Vault/Workspace owner for read-only navigator tests. */
class NavigatorHarness {
  content: string;
  editorContent: string;
  binaryContent = createBinary(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
  existingLeaf = true;
  missingFile = false;
  readonly readQueue: string[] = [];
  readonly binaryReadQueue: ArrayBuffer[] = [];
  readonly file: TFile;
  readonly editor: Editor & {
    getValue: jest.Mock;
    lineCount: jest.Mock;
    getLine: jest.Mock;
    setSelection: jest.Mock;
    scrollIntoView: jest.Mock;
    focus: jest.Mock;
  };
  readonly view: MarkdownView;
  readonly leaf: WorkspaceLeaf & { openFile: jest.Mock };
  readonly vault: Vault & {
    getAbstractFileByPath: jest.Mock;
    read: jest.Mock;
    readBinary: jest.Mock;
  };
  readonly workspace: Workspace & {
    iterateAllLeaves: jest.Mock;
    getLeaf: jest.Mock;
    revealLeaf: jest.Mock;
    openLinkText: jest.Mock;
  };
  readonly appOwner: { vault: Vault; workspace: Workspace };
  onOpen?: () => void;
  onOpenLink?: () => void;

  /** Creates one stable captured owner and visible Markdown editor. */
  constructor(
    content: string,
    editorContent = normalizeCitationText(content),
    sourcePath = SOURCE_PATH
  ) {
    this.content = content;
    this.editorContent = editorContent;
    this.file = createTestFile(sourcePath);
    this.editor = {
      getValue: jest.fn(() => this.editorContent),
      lineCount: jest.fn(() => normalizeCitationText(this.editorContent).split("\n").length),
      getLine: jest.fn(
        (line: number) => normalizeCitationText(this.editorContent).split("\n")[line] ?? ""
      ),
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
    } as unknown as NavigatorHarness["editor"];
    this.view = createTestMarkdownView(this.file, this.editor);
    this.leaf = {
      view: this.view,
      openFile: jest.fn(async () => {
        this.onOpen?.();
      }),
    } as unknown as NavigatorHarness["leaf"];
    this.vault = {
      getAbstractFileByPath: jest.fn((path: string) =>
        this.missingFile || path !== this.file.path ? null : this.file
      ),
      read: jest.fn(async () => this.readQueue.shift() ?? this.content),
      readBinary: jest.fn(async () => this.binaryReadQueue.shift() ?? this.binaryContent.slice(0)),
    } as unknown as NavigatorHarness["vault"];
    this.workspace = {
      iterateAllLeaves: jest.fn((callback: (leaf: WorkspaceLeaf) => void) => {
        if (this.existingLeaf) callback(this.leaf);
      }),
      getLeaf: jest.fn(() => this.leaf),
      revealLeaf: jest.fn(),
      openLinkText: jest.fn(async () => {
        this.onOpenLink?.();
      }),
    } as unknown as NavigatorHarness["workspace"];
    this.appOwner = { vault: this.vault, workspace: this.workspace };
  }

  /** Creates the navigator after every exact owner dependency is installed. */
  createNavigator(): ObsidianKnowledgeCitationNavigator {
    return new ObsidianKnowledgeCitationNavigator(this.appOwner as unknown as App);
  }
}

describe("ObsidianKnowledgeCitationNavigator", () => {
  it("keeps the newest citation as the final workspace target after an older open settles", async () => {
    const content = "# Evidence\nFirst fact\nSecond fact";
    const harness = new NavigatorHarness(content);
    const firstOpen = createDeferred<void>();
    const openOrder: string[] = [];
    harness.leaf.openFile.mockImplementationOnce(async () => {
      openOrder.push("first-start");
      await firstOpen.promise;
      openOrder.push("first-finish");
    });
    harness.leaf.openFile.mockImplementationOnce(async () => {
      openOrder.push("second");
    });
    const firstController = new AbortController();
    const firstCitation = createCitation({
      ...createLocatorBase(content, "First fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });
    const secondCitation = createCitation({
      ...createLocatorBase(content, "Second fact"),
      kind: "markdown_lines",
      startLine: 3,
      endLine: 3,
    });
    const navigator = harness.createNavigator();

    const oldNavigation = navigator.navigate(
      { sourcePath: SOURCE_PATH, citation: firstCitation },
      firstController.signal
    );
    await flushAsync();
    firstController.abort();
    const latestNavigation = navigator.navigate({
      sourcePath: SOURCE_PATH,
      citation: secondCitation,
    });
    await flushAsync();

    expect(openOrder).toEqual(["first-start"]);
    firstOpen.resolve();
    await expect(oldNavigation).resolves.toEqual({ status: "unavailable" });
    await expect(latestNavigation).resolves.toEqual({ status: "opened" });
    expect(openOrder).toEqual(["first-start", "first-finish", "second"]);
    expect(harness.editor.setSelection).toHaveBeenCalledTimes(1);
    expect(harness.editor.setSelection).toHaveBeenLastCalledWith(
      { line: 2, ch: 0 },
      { line: 2, ch: "Second fact".length }
    );
  });

  it("shares navigation ordering across adapters that own the same App", async () => {
    const content = "# Evidence\nFirst fact\nSecond fact";
    const harness = new NavigatorHarness(content);
    const firstOpen = createDeferred<void>();
    const openOrder: string[] = [];
    harness.leaf.openFile.mockImplementationOnce(async () => {
      openOrder.push("first-start");
      await firstOpen.promise;
      openOrder.push("first-finish");
    });
    harness.leaf.openFile.mockImplementationOnce(async () => {
      openOrder.push("second");
    });
    const firstController = new AbortController();
    const firstCitation = createCitation({
      ...createLocatorBase(content, "First fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });
    const secondCitation = createCitation({
      ...createLocatorBase(content, "Second fact"),
      kind: "markdown_lines",
      startLine: 3,
      endLine: 3,
    });

    const oldNavigation = harness
      .createNavigator()
      .navigate({ sourcePath: SOURCE_PATH, citation: firstCitation }, firstController.signal);
    await flushAsync();
    firstController.abort();
    const latestNavigation = harness
      .createNavigator()
      .navigate({ sourcePath: SOURCE_PATH, citation: secondCitation });
    await flushAsync();

    expect(openOrder).toEqual(["first-start"]);
    firstOpen.resolve();
    await expect(oldNavigation).resolves.toEqual({ status: "unavailable" });
    await expect(latestNavigation).resolves.toEqual({ status: "opened" });
    expect(openOrder).toEqual(["first-start", "first-finish", "second"]);
  });

  it("re-proves an exact Markdown citation without opening or changing the workspace", async () => {
    const content = "# Evidence\nGrounded fact";
    const harness = new NavigatorHarness(content);
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });

    await expect(
      harness.createNavigator().verify({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "verified" });
    expect(harness.vault.read).toHaveBeenCalledTimes(1);
    expect(harness.workspace.iterateAllLeaves).not.toHaveBeenCalled();
    expect(harness.workspace.getLeaf).not.toHaveBeenCalled();
    expect(harness.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(harness.leaf.openFile).not.toHaveBeenCalled();
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("reports stale verification without mutating the workspace", async () => {
    const original = "Grounded fact";
    const harness = new NavigatorHarness("Changed fact");
    const citation = createCitation({
      ...createLocatorBase(original, original),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().verify({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "stale" });
    expect(harness.leaf.openFile).not.toHaveBeenCalled();
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("opens an existing Markdown leaf and selects the hash-verified CRLF line range", async () => {
    const content = "# Evidence\r\nGrounded fact";
    const harness = new NavigatorHarness(content);
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 2,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "opened",
    });
    expect(harness.vault.read).toHaveBeenCalledTimes(2);
    expect(harness.leaf.openFile).toHaveBeenCalledWith(harness.file);
    expect(harness.workspace.getLeaf).not.toHaveBeenCalled();
    expect(harness.workspace.revealLeaf).toHaveBeenCalledWith(harness.leaf);
    expect(harness.editor.setSelection).toHaveBeenCalledWith(
      { line: 1, ch: 0 },
      { line: 1, ch: 13 }
    );
    expect(harness.editor.scrollIntoView).toHaveBeenCalledWith(
      { from: { line: 1, ch: 0 }, to: { line: 1, ch: 13 } },
      true
    );
    expect(harness.editor.focus).toHaveBeenCalledTimes(1);
  });

  it("opens a new tab when the exact source is not already visible", async () => {
    const content = "Grounded fact";
    const harness = new NavigatorHarness(content);
    harness.existingLeaf = false;
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "opened",
    });
    expect(harness.workspace.getLeaf).toHaveBeenCalledWith("tab");
    expect(harness.leaf.openFile).toHaveBeenCalledWith(harness.file);
  });

  it("returns stale without opening a leaf when the first exact read changed", async () => {
    const original = "Original fact";
    const harness = new NavigatorHarness("Changed fact");
    const citation = createCitation({
      ...createLocatorBase(original, "Original fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "stale",
    });
    expect(harness.leaf.openFile).not.toHaveBeenCalled();
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("returns stale when the exact source changes between opening and selection", async () => {
    const content = "Grounded fact";
    const harness = new NavigatorHarness(content);
    harness.readQueue.push(content, "Externally changed fact");
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "stale",
    });
    expect(harness.leaf.openFile).toHaveBeenCalledTimes(1);
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("returns stale when the displayed editor differs from the current Vault content", async () => {
    const content = "Grounded fact";
    const harness = new NavigatorHarness(content, "Unsaved editor change");
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "stale",
    });
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("returns unavailable unless opening produces the exact MarkdownView", async () => {
    const content = "Grounded fact";
    const harness = new NavigatorHarness(content);
    harness.onOpen = () => {
      (harness.leaf as unknown as { view: object }).view = {};
    };
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "unavailable",
    });
    expect(harness.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("verifies a PDF page from its exact raw-byte SHA-256 without workspace mutation", async () => {
    const harness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(harness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 4,
    });

    await expect(
      harness.createNavigator().verify({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "verified" });
    expect(harness.vault.readBinary).toHaveBeenCalledTimes(1);
    expect(harness.vault.read).not.toHaveBeenCalled();
    expect(harness.workspace.iterateAllLeaves).not.toHaveBeenCalled();
    expect(harness.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("opens a hash-proved PDF at its validated page through the canonical link contract", async () => {
    const harness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(harness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 4,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "opened" });
    expect(harness.vault.readBinary).toHaveBeenCalledTimes(2);
    expect(harness.workspace.openLinkText).toHaveBeenCalledWith(
      `${PDF_SOURCE_PATH}#page=4`,
      "",
      "tab"
    );
    expect(harness.workspace.iterateAllLeaves).not.toHaveBeenCalled();
    expect(harness.leaf.openFile).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous PDF linktext path before reading or opening the workspace", async () => {
    const ambiguousPath = "Sources/Research#Appendix.pdf";
    const harness = new NavigatorHarness("", "", ambiguousPath);
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(harness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 4,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: ambiguousPath, citation })
    ).resolves.toEqual({ status: "unsupported" });
    expect(harness.vault.readBinary).not.toHaveBeenCalled();
    expect(harness.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("fails stale before opening when current PDF bytes do not match the locator", async () => {
    const harness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(createBinary(1, 2, 3)),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 4,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "stale" });
    expect(harness.vault.readBinary).toHaveBeenCalledTimes(1);
    expect(harness.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("reports stale when the PDF changes across the asynchronous page open", async () => {
    const harness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const original = harness.binaryContent;
    harness.binaryReadQueue.push(original, createBinary(9, 8, 7));
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(original),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 2,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "stale" });
    expect(harness.workspace.openLinkText).toHaveBeenCalledTimes(1);
    expect(harness.vault.readBinary).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid PDF page or non-PDF TFile before opening", async () => {
    const invalidPageHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const invalidCitation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(invalidPageHarness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 0,
    });
    await expect(
      invalidPageHarness
        .createNavigator()
        .navigate({ sourcePath: PDF_SOURCE_PATH, citation: invalidCitation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(invalidPageHarness.vault.getAbstractFileByPath).not.toHaveBeenCalled();

    const wrongFileHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    (wrongFileHarness.file as unknown as { extension: string }).extension = "md";
    const validCitation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(wrongFileHarness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 1,
    });
    await expect(
      wrongFileHarness
        .createNavigator()
        .navigate({ sourcePath: PDF_SOURCE_PATH, citation: validCitation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(wrongFileHarness.vault.readBinary).not.toHaveBeenCalled();
    expect(wrongFileHarness.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("honors PDF cancellation and owner replacement around public page navigation", async () => {
    const readHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const readController = new AbortController();
    const readCitation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(readHarness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 1,
    });
    readHarness.vault.readBinary.mockImplementationOnce(async () => {
      readController.abort("private PDF read reason");
      return readHarness.binaryContent;
    });
    await expect(
      readHarness
        .createNavigator()
        .navigate({ sourcePath: PDF_SOURCE_PATH, citation: readCitation }, readController.signal)
    ).resolves.toEqual({ status: "unavailable" });
    expect(readHarness.workspace.openLinkText).not.toHaveBeenCalled();

    const cancelledOpenHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const openController = new AbortController();
    const cancelledOpenCitation = createCitation({
      ...readCitation.locator,
      artifactContentHash: createSourceContentHash(cancelledOpenHarness.binaryContent),
    });
    cancelledOpenHarness.onOpenLink = () => {
      openController.abort("private PDF open reason");
    };
    await expect(
      cancelledOpenHarness
        .createNavigator()
        .navigate(
          { sourcePath: PDF_SOURCE_PATH, citation: cancelledOpenCitation },
          openController.signal
        )
    ).resolves.toEqual({ status: "unavailable" });
    expect(cancelledOpenHarness.workspace.openLinkText).toHaveBeenCalledTimes(1);
    expect(cancelledOpenHarness.vault.readBinary).toHaveBeenCalledTimes(1);

    const openHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const openCitation = createCitation({
      ...readCitation.locator,
      artifactContentHash: createSourceContentHash(openHarness.binaryContent),
    });
    openHarness.onOpenLink = () => {
      openHarness.appOwner.workspace = {} as Workspace;
    };
    await expect(
      openHarness
        .createNavigator()
        .navigate({ sourcePath: PDF_SOURCE_PATH, citation: openCitation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(openHarness.workspace.openLinkText).toHaveBeenCalledTimes(1);
    expect(openHarness.vault.readBinary).toHaveBeenCalledTimes(1);
  });

  it("sanitizes malformed PDF reads and public link-open failures", async () => {
    const malformedHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    const citation = createCitation({
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: createSourceContentHash(malformedHarness.binaryContent),
      excerpt: "PDF page text",
      quoteHash: createQuoteHash("PDF page text"),
      kind: "pdf_page",
      page: 1,
    });
    malformedHarness.vault.readBinary.mockResolvedValueOnce({ byteLength: 8 });
    await expect(
      malformedHarness.createNavigator().navigate({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(malformedHarness.workspace.openLinkText).not.toHaveBeenCalled();

    const openFailureHarness = new NavigatorHarness("", "", PDF_SOURCE_PATH);
    openFailureHarness.workspace.openLinkText.mockRejectedValueOnce(
      new Error(`${PDF_SOURCE_PATH}: private viewer cause`)
    );
    await expect(
      openFailureHarness.createNavigator().navigate({ sourcePath: PDF_SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(openFailureHarness.vault.readBinary).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable for a missing file or replaced App owner", async () => {
    const content = "Grounded fact";
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });
    const missingHarness = new NavigatorHarness(content);
    missingHarness.missingFile = true;
    await expect(
      missingHarness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({ status: "unavailable" });
    expect(missingHarness.vault.read).not.toHaveBeenCalled();

    const replacedHarness = new NavigatorHarness(content);
    const navigator = replacedHarness.createNavigator();
    replacedHarness.appOwner.vault = {} as Vault;
    await expect(navigator.navigate({ sourcePath: SOURCE_PATH, citation })).resolves.toEqual({
      status: "unavailable",
    });
    expect(replacedHarness.vault.getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it("honors cancellation before and across asynchronous Vault boundaries", async () => {
    const content = "Grounded fact";
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });
    const beforeHarness = new NavigatorHarness(content);
    const beforeController = new AbortController();
    beforeController.abort("private abort reason");
    await expect(
      beforeHarness
        .createNavigator()
        .navigate({ sourcePath: SOURCE_PATH, citation }, beforeController.signal)
    ).resolves.toEqual({ status: "unavailable" });
    expect(beforeHarness.vault.getAbstractFileByPath).not.toHaveBeenCalled();

    const duringHarness = new NavigatorHarness(content);
    const duringController = new AbortController();
    duringHarness.vault.read.mockImplementationOnce(async () => {
      duringController.abort("private in-flight reason");
      return content;
    });
    await expect(
      duringHarness
        .createNavigator()
        .navigate({ sourcePath: SOURCE_PATH, citation }, duringController.signal)
    ).resolves.toEqual({ status: "unavailable" });
    expect(duringHarness.leaf.openFile).not.toHaveBeenCalled();
    expect(duringHarness.editor.setSelection).not.toHaveBeenCalled();
  });

  it("sanitizes Vault read failures without selecting or exposing the cause", async () => {
    const content = "Grounded fact";
    const harness = new NavigatorHarness(content);
    harness.vault.read.mockRejectedValueOnce(new Error(`${SOURCE_PATH}: private adapter cause`));
    const citation = createCitation({
      ...createLocatorBase(content, "Grounded fact"),
      kind: "quote",
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: SOURCE_PATH, citation })
    ).resolves.toEqual({
      status: "unavailable",
    });
    expect(harness.editor.setSelection).not.toHaveBeenCalled();
  });
});
