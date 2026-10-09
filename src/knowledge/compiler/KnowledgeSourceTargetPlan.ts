import type { CompilerWritingTarget } from "@/knowledge/compiler/CompilerWritingPlan";
import type { KnowledgeCompileInput } from "@/knowledge/compiler/CompilerModelPort";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

/**
 * Plans source-associated destinations without giving the model write authority.
 *
 * @param input - Compiler-validated source identity and existing page authority.
 */
export function createKnowledgeSourceTargetPlan(
  input: KnowledgeCompileInput
): CompilerWritingTarget[] {
  // Existing shared/user pages retain their explicit write authority and identities;
  // a new source must not depend on the model choosing any destination at all.
  // https://github.com/yydspanda/obsidian-copilot/issues/20
  const paths = input.targetAuthorizations
    .filter(
      (authorization) =>
        authorization.allowedIntents.includes("write") && authorization.contentPolicy === "grounded"
    )
    .map((authorization) => authorization.path)
    .sort();

  if (paths.length === 0) {
    const sourcePath = input.manifest.entries.find(
      (entry) => entry.sourceId === input.source.sourceId
    )!.sourcePath;
    const basename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
    // Fifty Unicode code points leave room for the identity suffix within the
    // filesystem's 255-byte basename limit, even with four-byte source characters.
    // The validated source path already excludes unsafe filename characters.
    // https://github.com/yydspanda/obsidian-copilot/issues/20
    const stem = Array.from(basename).slice(0, 50).join("") || "_";
    paths.push(`${input.bundle.wikiRoot}/${stem}-${sha256(input.source.sourceId).slice(0, 12)}.md`);
  }

  return paths.map((path) => ({
    ref: `source-page-${sha256(toWindowsPathKey(path)).slice(0, 12)}`,
    path,
    intent: "write",
    reason: "Organize the complete source material.",
    claimRefs: [],
  }));
}
