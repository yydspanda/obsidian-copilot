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
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import type { ClaimCitation, SourceLocator } from "@/knowledge/model/types";

import { ObsidianKnowledgeCitationNavigator } from "./ObsidianKnowledgeCitationNavigator";

const SOURCE_PATH = "Sources/Research.md";

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
  existingLeaf = true;
  missingFile = false;
  readonly readQueue: string[] = [];
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
  readonly vault: Vault & { getAbstractFileByPath: jest.Mock; read: jest.Mock };
  readonly workspace: Workspace & {
    iterateAllLeaves: jest.Mock;
    getLeaf: jest.Mock;
    revealLeaf: jest.Mock;
  };
  readonly appOwner: { vault: Vault; workspace: Workspace };
  onOpen?: () => void;

  /** Creates one stable captured owner and visible Markdown editor. */
  constructor(content: string, editorContent = normalizeCitationText(content)) {
    this.content = content;
    this.editorContent = editorContent;
    this.file = createTestFile(SOURCE_PATH);
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
      getAbstractFileByPath: jest.fn(() => (this.missingFile ? null : this.file)),
      read: jest.fn(async () => this.readQueue.shift() ?? this.content),
    } as unknown as NavigatorHarness["vault"];
    this.workspace = {
      iterateAllLeaves: jest.fn((callback: (leaf: WorkspaceLeaf) => void) => {
        if (this.existingLeaf) callback(this.leaf);
      }),
      getLeaf: jest.fn(() => this.leaf),
      revealLeaf: jest.fn(),
    } as unknown as NavigatorHarness["workspace"];
    this.appOwner = { vault: this.vault, workspace: this.workspace };
  }

  /** Creates the navigator after every exact owner dependency is installed. */
  createNavigator(): ObsidianKnowledgeCitationNavigator {
    return new ObsidianKnowledgeCitationNavigator(this.appOwner as unknown as App);
  }
}

describe("ObsidianKnowledgeCitationNavigator", () => {
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

  it("returns unsupported for PDF pages without touching the Vault or Workspace", async () => {
    const content = "PDF page text";
    const harness = new NavigatorHarness(content);
    const citation = createCitation({
      ...createLocatorBase(content, "page text"),
      kind: "pdf_page",
      page: 1,
    });

    await expect(
      harness.createNavigator().navigate({ sourcePath: "Sources/Paper.pdf", citation })
    ).resolves.toEqual({ status: "unsupported" });
    expect(harness.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(harness.vault.read).not.toHaveBeenCalled();
    expect(harness.workspace.iterateAllLeaves).not.toHaveBeenCalled();
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
