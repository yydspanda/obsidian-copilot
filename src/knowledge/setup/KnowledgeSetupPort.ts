/** Existing Project offered to the first-time Knowledge setup form. */
export interface KnowledgeSetupProjectOption {
  id: string;
  name: string;
}

/** An enabled model whose exact configured identity passes Knowledge policy. */
export interface KnowledgeSetupModelOption {
  configuredModelId: string;
  label: string;
}

/** Local, credential-free choices; opening setup never calls a model. */
export interface KnowledgeSetupOptions {
  availability: "available" | "bundle_exists" | "unavailable";
  projects: readonly KnowledgeSetupProjectOption[];
  models: readonly KnowledgeSetupModelOption[];
}

/** Explicit rules-file intent; existing content is never replaced. */
export type KnowledgeSetupRules = { kind: "create"; content: string } | { kind: "reuse" };

/** User-confirmed destinations and exact model for an existing Project. */
export interface KnowledgeSetupRequest {
  projectId: string;
  configuredModelId: string;
  sourceRoot: string;
  wikiRoot: string;
  schemaRef: string;
  rules: KnowledgeSetupRules;
}

/** Local configuration committed without source registration or model requests. */
export interface KnowledgeSetupReceipt {
  projectId: string;
  bundleId: string;
  sourceRoot: string;
  wikiRoot: string;
  schemaRef: string;
}

export type KnowledgeSetupErrorCode =
  | "unavailable"
  | "busy"
  | "invalid_configuration"
  | "project_changed"
  | "bundle_exists"
  | "model_unavailable"
  | "unsafe_path"
  | "rules_conflict"
  | "rules_invalid"
  | "write_failed";

/** Sanitized setup failure. New folders or a newly created rules file may remain. */
export class KnowledgeSetupError extends Error {
  constructor(public readonly code: KnowledgeSetupErrorCode) {
    super(
      "Knowledge setup could not be completed. New folders or rules may remain; existing files were not replaced."
    );
    this.name = "KnowledgeSetupError";
  }
}

/** Explicit local setup authority, separate from read-only Setup navigation. */
export interface KnowledgeSetupPort {
  getOptions(): KnowledgeSetupOptions;
  configure(
    request: Readonly<KnowledgeSetupRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeSetupReceipt>;
}
