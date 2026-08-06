# Projects

Projects are focused AI workspaces. Each project has its own model, system prompt, context sources, and completely isolated chat history. Use projects to keep separate AI conversations per client, topic, or area of work.

Projects support **50+ file types** beyond markdown, including PDFs, Word documents, PowerPoint, Excel, images, and more — making them ideal for analyzing large or diverse document collections.

> **Note**: Projects is an alpha feature. It may have rough edges and is subject to change.

---

## Overview

In regular chat, all conversations share the same settings and model. Projects let you create dedicated workspaces with:

- **A specific context** — Specific notes, folders, URLs, or YouTube videos the AI always has access to
- **A dedicated model** — Different projects can use different AI models
- **A custom system prompt** — Each project can have its own instructions for the AI
- **Isolated chat history** — Conversations in one project don't mix with conversations in another

**Example use cases:**

- A "Research" project that always has your research notes as context
- A "Client Work" project with a specific system prompt and access to client-related notes
- A "Learning" project with YouTube video URLs for study materials

---

## Creating a Project

1. Open the chat panel
2. Click the mode selector at the top of the chat
3. Select **Projects (alpha)**
4. Click **New Project** (or the `+` button)
5. Fill in the project details and save

---

## Project Configuration

Each project has the following settings:

### Name

A short name for the project. Appears in the project list.

### Description

An optional description of what the project is for.

### Model

Choose which AI model to use for this project. The available options depend on which models you have enabled.

### Model Settings

Override the default temperature and max tokens specifically for this project.

For direct DeepSeek V4 models, the project keeps the selected model's explicit thinking mode.
`deepseek-v4-pro` uses a zero temperature placeholder for High thinking, and Copilot does not send
Temperature or Top P while thinking is enabled. If the selected model later changes from Minimal
to High or XHigh, Copilot normalizes any older project temperature override to zero before the
project runs. A project that still references a retired
`deepseek-chat` or `deepseek-reasoner` identity stops and asks for a new selection instead of
switching providers silently.

### System Prompt

Set a custom system prompt for this project. This replaces (or supplements) the global default. See [System Prompts](system-prompts.md) for details.

### Knowledge Bundle (advanced, Windows only)

This fork can preserve an optional `copilot-project-knowledge-bundle` object in the project's `project.md` frontmatter. It defines the source, generated Wiki, and schema boundaries owned by Personal Knowledge Studio:

```yaml
copilot-project-knowledge-bundle:
  version: 1
  id: research
  sourceRoots:
    - Sources/Research
  wikiRoot: Wiki/Research
  schemaRef: Knowledge/Schemas/research.md
  reviewMode: always
```

The knowledge startup boundary validates this object strictly after all Projects have loaded. It rejects unknown fields, malformed Vault-relative paths, duplicate Bundle IDs, and case-insensitive Windows overlaps between any configured source, Wiki, and schema boundaries. It does not rewrite an unsafe path. If any project's Bundle is invalid, all knowledge adapters remain unavailable so write ownership cannot become ambiguous.

This field does not change normal Project chat behavior. With one valid Bundle and a successful recovery/observation release, the plugin can ingest authorized sources in the background, run the two-stage DeepSeek compiler, and persist a proposal in durable Review. Preflight and the startup Gates are zero-network, but released compilation sends authorized knowledge content to DeepSeek and may incur provider charges. The background worker stops at `awaiting_review` and has no Apply authority. In the live Studio, a user can inspect Activity, reject a proposal, or explicitly accept eligible create/update selections; that separate command path revalidates durable state, runs the recoverable transaction, and finalizes its Manifest, Queue, journal, and ledger records. On Windows, dragging a Vault `.md`, `.markdown`, or `.txt` file into Chat shows **Use in this chat** and **Add to Knowledge** before either state changes. Durable registration is offered only when one Bundle with one source root is live and the file already belongs to that root; it does not attach the file to Chat context. The Query tab searches only SHA-256-verified pages from the Bundle's accepted and committed Wiki and never falls back to other Vault notes. When exact Markdown source evidence can be re-proved, Query sends the question, bounded Wiki context, and those source excerpts to a separate DeepSeek answer route in one request, then validates every returned evidence ID before showing a read-only answer. With no eligible source evidence, it returns **Insufficient evidence** without calling the model. Existing PDF citation chips can open a positive validated page only after the exact `.pdf` raw-byte SHA-256 is re-proved; this read-only navigation does not add PDF ingestion or PDF evidence to the H.2 answer route. A current Supported or Partial answer with at least one validated claim can be saved through Review. Save re-proves its answer and citations, creates a deterministic content-addressed managed Markdown source beneath the Bundle's one configured source root, and registers an exact `managed_copy` Manifest origin. The real watcher and Queue then compile it with `operation: query_writeback`; the first applied provenance points to that capture, whose content embeds the original evidence chain. Save never writes Wiki directly or fabricates a queued result, and the proposal still requires explicit Review and Apply. A nested create target requires its parent Wiki folder to exist on the Windows adapter; otherwise Review submission blocks before durable acceptance and does not create an untracked directory. Exact retry can converge an uncertain create/registration result, although a crash after create and before registration can leave an unregistered orphan capture. Nothing auto-accepts or auto-applies; delete, PDF ingestion, and Windows Explorer capture remain disabled. Fresh create/update Apply, fail-closed external-edit handling, limited Recovery, scoped retrieval, exact Markdown quote navigation, H.2 grounded answers, the complete Save-to-Wiki capture-through-Apply chain, and both Vault-text Chat intents have passed bounded acceptance in an independent Windows test Vault. PDF page navigation has automated coverage but still requires its Windows interaction gate. The H.2 run covered real DeepSeek answers, source-fact and inference labels, all three answer statuses, exact citation selection, deterministic zero-request no-evidence behavior, reload cancellation, and query-local zero writes. Broader filesystem races and crash or power-loss behavior remain separate gates. Changing Settings or Project configuration automatically closes the old generation and starts a fresh validation generation; a plugin reload is not required for this revalidation. See [Personal Knowledge Studio](personal-knowledge.md) for the full availability and safety model.

---

## Context Sources

Projects let you pre-load context that is always available in the project's chat.

### File Inclusions and Exclusions

Specify which notes or folders to include in this project's context:

- **Inclusions**: Only these notes/folders are available for search and context
- **Exclusions**: These notes/folders are excluded from context

This scopes the AI's knowledge to just the notes relevant to your project.

### Web URLs

Add web page URLs that are fetched and included as context for every conversation in this project. Useful for documentation, reference pages, or web resources you frequently consult.

### YouTube URLs

Add YouTube video URLs whose transcripts are loaded into context for every conversation.

---

## Working in a Project

### Switching Projects

Use the project selector at the top of the chat panel to switch between projects. When you switch, the chat history clears and the new project's context loads.

### Isolated Chat History

Each project maintains its own chat history, completely separate from other projects and from regular (non-project) chat. Conversations don't bleed across projects.

### Context Loading

When you open a project, Copilot loads the configured context (notes, URLs, etc.) automatically. For large projects with many notes, this may take a moment.

---

## Project List Management

Go to the project selector to manage your projects:

- **Sort**: Projects can be sorted by most recently used or alphabetically
- **Edit**: Click the edit icon to change a project's settings
- **Delete**: Remove the project entry from the list (saved conversation files in your vault are not deleted)

Sort strategy: **Settings → Copilot → Basic → Project list sort strategy**

---

## Limitations

As an alpha feature, projects have some known limitations:

- Large context sources (many notes or large files) may slow down context loading
- The context loading on project switch is synchronous — the AI isn't available until loading completes
- Some features available in regular Plus mode may behave differently in projects
- Auto-compact behavior is the same as regular chat

---

## Related

- [Chat Interface](chat-interface.md) — Chat modes overview, new chat behavior, history
- [System Prompts](system-prompts.md) — Custom system prompts for projects
- [Context and Mentions](context-and-mentions.md) — How context works
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Plus features
