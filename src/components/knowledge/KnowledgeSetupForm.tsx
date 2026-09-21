import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  KnowledgeSetupError,
  type KnowledgeSetupErrorCode,
  type KnowledgeSetupOptions,
  type KnowledgeSetupPort,
} from "@/knowledge/setup/KnowledgeSetupPort";
import { cn } from "@/lib/utils";

export interface KnowledgeSetupFormProps {
  port: KnowledgeSetupPort;
  onConfigured?: () => void;
}

const EMPTY_OPTIONS: KnowledgeSetupOptions = Object.freeze({
  availability: "unavailable",
  projects: Object.freeze([]),
  models: Object.freeze([]),
});

// These are editable defaults for a new rules file, not an internal compiler prompt.
// Separate page ownership prevents unrelated sources from competing for a shared target.
// https://github.com/yydspanda/obsidian-copilot/issues/13
const INITIAL_RULES = `# Knowledge rules

- Use only facts supported by the source. Distinguish quotations, personal interpretation and inference.
- Summarize the main ideas, evidence, applicable conditions and open questions; do not invent missing information.
- Create Markdown pages directly inside the configured Wiki folder, without subfolders.
- Every page must include YAML frontmatter with type: knowledge.
- Update an existing page only when this source is authorized to own it. Otherwise create a separately named page; never overwrite another source's page.
- Describe sources in plain text. Do not emit wiki links, Markdown links, URLs, email addresses or HTML.
- Never delete files or modify the source material.
`;

const ERROR_COPY: Readonly<Record<KnowledgeSetupErrorCode, string>> = {
  unavailable: "Setup is not available in this session. Refresh the status and try again.",
  busy: "Another setup is still saving. Wait for it to finish.",
  invalid_configuration:
    "Check the folder paths. Source and Wiki folders must be separate, and rules must be outside the Wiki folder.",
  project_changed: "The Project changed while setup was open. Refresh the status and reopen setup.",
  bundle_exists: "A Knowledge Bundle is already configured. Its configuration was not replaced.",
  model_unavailable:
    "That model is no longer available for Knowledge. Check Copilot model settings and reopen setup.",
  unsafe_path:
    "A location is not a safe folder or file inside this Vault. Choose a different location.",
  rules_conflict:
    "The rules file already exists. Select Use existing rules file to keep it, or choose a new path.",
  rules_invalid:
    "Rules must be a non-empty, bounded text file. Check the rules content or existing file.",
  write_failed:
    "Setup could not be completed. New folders or rules may remain; check them before retrying. Existing files were not replaced.",
};

/** User-confirmed local setup; no provider request or automatic material registration. */
export function KnowledgeSetupForm({
  port,
  onConfigured,
}: KnowledgeSetupFormProps): React.ReactElement {
  const [options] = React.useState(() => {
    try {
      return port.getOptions();
    } catch {
      return EMPTY_OPTIONS;
    }
  });
  const [projectId, setProjectId] = React.useState(
    options.projects.length === 1 ? options.projects[0].id : ""
  );
  const [modelId, setModelId] = React.useState("");
  const [sourceRoot, setSourceRoot] = React.useState("Sources/Knowledge");
  const [wikiRoot, setWikiRoot] = React.useState("Wiki/Knowledge");
  const [schemaRef, setSchemaRef] = React.useState("Knowledge/rules.md");
  const [reuseRules, setReuseRules] = React.useState(false);
  const [rulesContent, setRulesContent] = React.useState(INITIAL_RULES);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const pending = React.useRef<AbortController>();
  const id = React.useId();
  React.useEffect(
    () => () => {
      pending.current?.abort();
    },
    [port]
  );

  const disabled = saving || saved || options.availability !== "available";
  const canSave =
    !disabled &&
    projectId !== "" &&
    modelId !== "" &&
    sourceRoot.trim() !== "" &&
    wikiRoot.trim() !== "" &&
    schemaRef.trim() !== "" &&
    (reuseRules || rulesContent.trim() !== "");

  const save = async (): Promise<void> => {
    if (!canSave || pending.current) return;
    const operation = new AbortController();
    pending.current = operation;
    setSaving(true);
    setError(undefined);
    try {
      await port.configure(
        {
          projectId,
          configuredModelId: modelId,
          sourceRoot,
          wikiRoot,
          schemaRef,
          rules: reuseRules ? { kind: "reuse" } : { kind: "create", content: rulesContent },
        },
        operation.signal
      );
      // A committed setup can trigger its own refresh before this receipt settles.
      // Keep the parent receipt even when that refresh unmounted the form.
      // https://github.com/yydspanda/obsidian-copilot/issues/13
      onConfigured?.();
      if (operation.signal.aborted) return;
      setSaved(true);
    } catch (failure) {
      if (!operation.signal.aborted) {
        setError(
          ERROR_COPY[failure instanceof KnowledgeSetupError ? failure.code : "write_failed"]
        );
      }
    } finally {
      if (pending.current === operation) pending.current = undefined;
      if (!operation.signal.aborted) setSaving(false);
    }
  };

  return (
    <section
      aria-label="Configure Knowledge"
      className="tw-space-y-3 tw-rounded-xl tw-border tw-border-solid tw-border-border tw-p-4"
    >
      <h2 className="tw-m-0 tw-text-sm tw-font-semibold">Finish Knowledge setup</h2>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Choose an existing Copilot Project and a Knowledge model. Confirming creates missing folders
        and saves this Project's Knowledge configuration; it does not import materials or call a
        model.
      </p>
      {options.availability === "bundle_exists" ? (
        <p role="note">A Knowledge Bundle already exists. Setup will not replace it.</p>
      ) : null}
      {options.availability === "unavailable" ? (
        <p role="alert">Setup options are unavailable. Refresh the status and reopen setup.</p>
      ) : null}
      {options.projects.length === 0 ? (
        <p className="tw-text-sm">
          Create a Copilot Project first in Agent Chat, then return here.
        </p>
      ) : null}
      {options.models.length === 0 ? (
        <p className="tw-text-sm">
          Add an official DeepSeek model in Copilot settings and enable it for Chat, then reopen
          setup. Agent Chat's subscription model is separate.
        </p>
      ) : null}
      <div className="tw-grid tw-gap-3">
        <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-project`}>
          Copilot Project
          <select
            id={`${id}-project`}
            className="tw-w-full tw-min-w-0"
            disabled={disabled}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a Project</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-model`}>
          Knowledge model
          <select
            id={`${id}-model`}
            className="tw-w-full tw-min-w-0"
            disabled={disabled}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">Choose a model</option>
            {options.models.map((model) => (
              <option key={model.configuredModelId} value={model.configuredModelId}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <p className="tw-m-0 tw-text-xs tw-text-muted">
          This sets the Project model used by Knowledge; it does not change your Agent Chat model.
          Later material analysis can incur API charges.
        </p>
        <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-source`}>
          Source folder
          <Input
            id={`${id}-source`}
            disabled={disabled}
            value={sourceRoot}
            onChange={(event) => setSourceRoot(event.target.value)}
          />
        </label>
        <p className="tw-m-0 tw-text-xs tw-text-muted">
          An existing folder or a new Vault-relative path. Files are processed only after you
          explicitly add them.
        </p>
        <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-wiki`}>
          Wiki folder
          <Input
            id={`${id}-wiki`}
            disabled={disabled}
            value={wikiRoot}
            onChange={(event) => setWikiRoot(event.target.value)}
          />
        </label>
        <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-rules`}>
          Rules file
          <Input
            id={`${id}-rules`}
            disabled={disabled}
            value={schemaRef}
            onChange={(event) => setSchemaRef(event.target.value)}
          />
        </label>
        <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={reuseRules}
            onChange={(event) => setReuseRules(event.target.checked)}
          />
          Use existing rules file without changing it
        </label>
        {!reuseRules ? (
          <label className="tw-grid tw-gap-1 tw-text-sm" htmlFor={`${id}-content`}>
            Rules content
            <Textarea
              id={`${id}-content`}
              className="tw-min-h-48"
              disabled={disabled}
              value={rulesContent}
              onChange={(event) => setRulesContent(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <p className="tw-m-0 tw-text-xs tw-text-muted">
        Existing notes and rules are never overwritten. Wiki changes always require your Review and
        Apply.
      </p>
      <Button type="button" disabled={!canSave} onClick={() => void save()}>
        {saving ? "Saving setup…" : "Create Knowledge setup"}
      </Button>
      {error ? (
        <p role="alert" className={cn("tw-m-0 tw-break-words tw-text-sm tw-text-error")}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="tw-m-0 tw-text-sm">
          Setup saved. Studio is checking the configuration. No material was imported and no model
          request was made by setup.
        </p>
      ) : null}
    </section>
  );
}
