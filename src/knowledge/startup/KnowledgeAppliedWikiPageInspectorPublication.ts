import { KnowledgeAppliedWikiPageInspectorGenerationLease } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorGenerationLease";
import type { KnowledgeAppliedWikiPageInspectorPort } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import type {
  KnowledgeAppliedWikiPathIndexLease,
  KnowledgeAppliedWikiPathIndexRow,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";

/** Inspector plus the least-authority advisory row projection needed for publication. */
export type KnowledgeAppliedWikiPageInspectorPublicationDelegate =
  KnowledgeAppliedWikiPageInspectorPort & {
    listAppliedWikiPathIndexRows(
      signal: AbortSignal
    ): Promise<readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]>;
  };

/** Internal main-owned integration capabilities for one optional publication attempt. */
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

/** Creates the platform-standard cancellation for an obsolete startup generation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Runs presentation cleanup without allowing optional UI failures to escape. */
function closePresentationsSafely(closePresentations: () => void): void {
  try {
    closePresentations();
  } catch {
    // Inspector authority is revoked independently from presentation cleanup.
  }
}

/** Re-proves the outer production generation or converts staleness to cancellation. */
function assertPublicationCurrent(input: KnowledgeAppliedWikiPageInspectorPublicationInput): void {
  if (input.signal.aborted) throw createAbortError();
  try {
    input.assertCurrent();
  } catch {
    throw createAbortError();
  }
  if (input.signal.aborted) throw createAbortError();
}

/**
 * Best-effort publishes one optional applied-Wiki inspector generation.
 *
 * Local create, row-list, or lease failures leave the stable surfaces
 * unavailable and return `undefined`, allowing worker and Studio release to
 * continue. An obsolete outer production generation still cancels the caller.
 *
 * @param input - Exact generation and conditional publication capabilities
 * @returns Installed exact-generation lease, or undefined for a local optional failure
 */
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
