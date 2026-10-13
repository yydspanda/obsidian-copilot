export interface KnowledgeSetupProjectOption {
  id: string;
  name: string;
}

export interface KnowledgeSetupModelOption {
  configuredModelId: string;
  label: string;
}

export interface KnowledgeSetupOptions {
  availability: "available" | "bundle_exists" | "unavailable";
  projects: readonly KnowledgeSetupProjectOption[];
  models: readonly KnowledgeSetupModelOption[];
}

export type KnowledgeSetupRules = { kind: "create"; content: string } | { kind: "reuse" };

export interface KnowledgeSetupRequest {
  projectId: string;
  configuredModelId: string;
  sourceRoot: string;
  wikiRoot: string;
  schemaRef: string;
  rules: KnowledgeSetupRules;
}

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

export class KnowledgeSetupError extends Error {
  constructor(public readonly code: KnowledgeSetupErrorCode) {
    super(
      "Knowledge setup could not be completed. New folders or rules may remain; existing files were not replaced."
    );
    this.name = "KnowledgeSetupError";
  }
}

export interface KnowledgeSetupPort {
  getOptions(): KnowledgeSetupOptions;
  configure(
    request: Readonly<KnowledgeSetupRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeSetupReceipt>;
}
