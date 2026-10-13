import { KnowledgeAppliedWikiPageInspectorGenerationLease } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorGenerationLease";
import type { KnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type {
  KnowledgeAppliedWikiPathIndexLease,
  KnowledgeAppliedWikiPathIndexRow,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

export type KnowledgeAppliedWikiPageInspectorPublicationDelegate =
  KnowledgeAppliedWikiPageInspectorPort & {
    listAppliedWikiPathIndexRows(
      signal: AbortSignal
    ): Promise<readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]>;
  };

export interface KnowledgeAppliedWikiPageInspectorPublicationInput {
  readonly signal: AbortSignal;
  readonly createDelegate: () => KnowledgeAppliedWikiPageInspectorPublicationDelegate;
  readonly subscribeInvalidation: (listener: () => void) => () => void;
  readonly replaceDelegate: (delegate: KnowledgeAppliedWikiPageInspectorPort) => void;
  readonly revokeDelegate: (delegate: KnowledgeAppliedWikiPageInspectorPort) => void;
  readonly installPathIndex: (
    rows: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
  ) => KnowledgeAppliedWikiPathIndexLease;
  readonly revokePathIndex: (lease: KnowledgeAppliedWikiPathIndexLease) => void;
  readonly assertCurrent: () => void;
  readonly closePresentations: () => void;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function closePresentationsSafely(closePresentations: () => void): void {
  try {
    closePresentations();
  } catch {
    // Inspector authority is revoked independently from presentation cleanup.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

function assertPublicationCurrent(input: KnowledgeAppliedWikiPageInspectorPublicationInput): void {
  if (input.signal.aborted) throw createAbortError();
  try {
    input.assertCurrent();
  } catch {
    throw createAbortError();
  }
  if (input.signal.aborted) throw createAbortError();
}

export async function tryPublishKnowledgeAppliedWikiPageInspectorGeneration(
  input: KnowledgeAppliedWikiPageInspectorPublicationInput
): Promise<KnowledgeAppliedWikiPageInspectorGenerationLease | undefined> {
  let generation: KnowledgeAppliedWikiPageInspectorGenerationLease | undefined;
  try {
    assertPublicationCurrent(input);
    const delegate = input.createDelegate();
    const indexRows = await delegate.listAppliedWikiPathIndexRows(input.signal);
    assertPublicationCurrent(input);
    generation = new KnowledgeAppliedWikiPageInspectorGenerationLease({
      delegate,
      indexRows,
      subscribeInvalidation: (listener) =>
        input.subscribeInvalidation(() => {
          try {
            listener();
          } finally {
            closePresentationsSafely(input.closePresentations);
          }
        }),
      replaceDelegate: input.replaceDelegate,
      revokeDelegate: input.revokeDelegate,
      installPathIndex: input.installPathIndex,
      revokePathIndex: input.revokePathIndex,
      assertCurrent: input.assertCurrent,
    });
    generation.assertCurrent();
    return generation;
  } catch {
    generation?.close();
    closePresentationsSafely(input.closePresentations);
    assertPublicationCurrent(input);
    return undefined;
  }
}
