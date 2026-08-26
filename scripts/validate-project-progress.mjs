import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const TASK_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const EXPERIMENT_ID_PATTERN = /^EXP-(\d{4})(\d{2})(\d{2})-(\d{3})$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function lineCount(text) {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function secondLevelSections(text) {
  const headings = [...text.matchAll(/^## ([^\n]+)$/gm)];
  return headings.map((heading, index) => ({
    title: heading[1],
    body: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length),
  }));
}

function registeredIds(roadmapText, roadmapPath, errors) {
  const stageIds = new Set();
  const taskIds = new Set();
  const allIds = new Set();
  const definitions = [...roadmapText.matchAll(/^- (Task|Stage) ID: `([^`]+)`(?:\s+—|\s*$)/gm)];

  for (const definition of definitions) {
    const kind = definition[1];
    const id = definition[2];
    if (!TASK_ID_PATTERN.test(id)) {
      errors.push(`${roadmapPath}: invalid registered ID \`${id}\``);
      continue;
    }
    if (allIds.has(id)) {
      errors.push(`${roadmapPath}: duplicate registered ID \`${id}\``);
      continue;
    }
    allIds.add(id);
    (kind === "Stage" ? stageIds : taskIds).add(id);
  }

  if (allIds.size === 0) {
    errors.push(`${roadmapPath}: no Task ID or Stage ID definitions found`);
  }
  return { stageIds, taskIds };
}

function validateTracker({ path: trackerPath, text }, registry, limits, errors) {
  const sections = secondLevelSections(text);
  const currentStageSections = sections.filter((section) => section.title === "Current Stage");
  const inProgressSections = sections.filter((section) => section.title === "In Progress");
  const recentActivitySections = sections.filter((section) => section.title === "Recent Activity");

  if (lineCount(text) > limits.maxTrackerLines) {
    errors.push(
      `${trackerPath}: ${lineCount(text)} lines exceeds the live-tracker limit of ${limits.maxTrackerLines}`
    );
  }
  if (currentStageSections.length !== 1) {
    errors.push(`${trackerPath}: expected exactly one \`## Current Stage\` section`);
  }
  if (inProgressSections.length !== 1) {
    errors.push(`${trackerPath}: expected exactly one \`## In Progress\` section`);
  }
  if (recentActivitySections.length !== 1) {
    errors.push(`${trackerPath}: expected exactly one \`## Recent Activity\` section`);
  }

  // Indentation must not hide an extra task from the single-owner invariant tracked by
  // https://github.com/yydspanda/obsidian-copilot/issues/1.
  const pendingTasks = [...text.matchAll(/^[ \t]*- \[ \] (.+)$/gm)];
  const completedTasks = [...text.matchAll(/^[ \t]*- \[[xX]\] /gm)];
  if (pendingTasks.length !== 1) {
    errors.push(`${trackerPath}: expected exactly one unchecked task in the entire live tracker`);
  }
  if (completedTasks.length > 0) {
    errors.push(`${trackerPath}: completed checkboxes belong in the monthly archive`);
  }

  // A registered Stage ID cannot satisfy a Task field, or vice versa. This role boundary
  // originates from https://github.com/yydspanda/obsidian-copilot/issues/1.
  if (inProgressSections.length === 1) {
    const sectionTasks = [...inProgressSections[0].body.matchAll(/^[ \t]*- \[ \] (.+)$/gm)];
    if (sectionTasks.length !== 1) {
      errors.push(`${trackerPath}: \`## In Progress\` must contain exactly one unchecked task`);
    } else {
      const taskIdMatch = /^[ \t]*- \[ \] `([^`]+)`\s+—/m.exec(sectionTasks[0][0]);
      if (!taskIdMatch || !TASK_ID_PATTERN.test(taskIdMatch[1])) {
        errors.push(
          `${trackerPath}: the in-progress task must start with a valid backticked Task ID`
        );
      } else if (!registry.taskIds.has(taskIdMatch[1])) {
        errors.push(
          `${trackerPath}: in-progress Task ID \`${taskIdMatch[1]}\` is not registered as a Task ID in the roadmap`
        );
      }
    }
  }

  if (currentStageSections.length === 1) {
    const stageFields = [...currentStageSections[0].body.matchAll(/^- Stage ID: `([^`]+)`\s*$/gm)];
    if (stageFields.length !== 1) {
      errors.push(`${trackerPath}: \`## Current Stage\` must contain exactly one Stage ID field`);
    } else if (!TASK_ID_PATTERN.test(stageFields[0][1])) {
      errors.push(`${trackerPath}: Current Stage ID \`${stageFields[0][1]}\` is invalid`);
    } else if (!registry.stageIds.has(stageFields[0][1])) {
      errors.push(
        `${trackerPath}: Current Stage ID \`${stageFields[0][1]}\` is not registered as a Stage ID in the roadmap`
      );
    }
  }

  if (recentActivitySections.length === 1) {
    const records = [...recentActivitySections[0].body.matchAll(/^[ \t]*- (.+)$/gm)];
    if (records.length > limits.maxRecentActivity) {
      errors.push(
        `${trackerPath}: ${records.length} recent records exceeds the limit of ${limits.maxRecentActivity}`
      );
    }
    for (const record of records) {
      const recordMatch = /^[ \t]*- \d{4}-\d{2}-\d{2} — `([^`]+)` —/.exec(record[0]);
      if (!recordMatch || !TASK_ID_PATTERN.test(recordMatch[1])) {
        errors.push(
          `${trackerPath}: every recent record must start with a date and valid backticked Task ID`
        );
      } else if (!registry.taskIds.has(recordMatch[1])) {
        errors.push(
          `${trackerPath}: recent Task ID \`${recordMatch[1]}\` is not registered as a Task ID in the roadmap`
        );
      }
    }
  }
}

function validateArchives(documents, registry, errors) {
  for (const document of documents) {
    const fileName = path.basename(document.path);
    const monthMatch = /^(\d{4})-(\d{2})\.md$/.exec(fileName);
    if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) {
      errors.push(`${document.path}: archive filename must be YYYY-MM.md`);
      continue;
    }

    if (/^## (?:Current Stage|In Progress)$/m.test(document.text)) {
      errors.push(`${document.path}: monthly archives cannot contain active-stage sections`);
    }
    if (/^[ \t]*- \[ \] /m.test(document.text)) {
      errors.push(`${document.path}: monthly archives cannot contain unchecked tasks`);
    }

    const completionLines = [...document.text.matchAll(/^[ \t]*- \[[xX]\] (.+)$/gm)];
    for (const completion of completionLines) {
      const completionMatch = /^[ \t]*- \[[xX]\] `([^`]+)`\s+—/m.exec(completion[0]);
      if (!completionMatch || !TASK_ID_PATTERN.test(completionMatch[1])) {
        errors.push(`${document.path}: every completed checkbox must start with a Task ID`);
      } else if (!registry.taskIds.has(completionMatch[1])) {
        errors.push(
          `${document.path}: completed Task ID \`${completionMatch[1]}\` is not registered as a Task ID in the roadmap`
        );
      }
    }

    // Plain recurring or migrated facts use an explicit marker so technical tokens such as
    // `SHA-256` are not mistaken for task identities. This contract originates from
    // https://github.com/yydspanda/obsidian-copilot/issues/1.
    const taskEvents = [...document.text.matchAll(/^[ \t]*- Task event: (.+)$/gm)];
    for (const taskEvent of taskEvents) {
      const eventMatch = /^[ \t]*- Task event: `([^`]+)`\s+—/m.exec(taskEvent[0]);
      if (!eventMatch || !TASK_ID_PATTERN.test(eventMatch[1])) {
        errors.push(`${document.path}: every Task event must start with a valid Task ID`);
      } else if (!registry.taskIds.has(eventMatch[1])) {
        errors.push(
          `${document.path}: Task event ID \`${eventMatch[1]}\` is not registered as a Task ID in the roadmap`
        );
      }
    }

    const datedHeadings = [...document.text.matchAll(/^## (\d{4})-(\d{2})-(\d{2})$/gm)];
    if (datedHeadings.length === 0) {
      errors.push(
        `${document.path}: monthly archive must contain at least one dated completion section`
      );
    }
    for (const heading of datedHeadings) {
      if (heading[1] !== monthMatch[1] || heading[2] !== monthMatch[2]) {
        errors.push(
          `${document.path}: completion date ${heading[0].slice(3)} does not match filename`
        );
      }
    }
  }
}

function fieldValues(block, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...block.matchAll(new RegExp("^- " + escapedLabel + ": `([^`]+)`\\s*$", "gm"))].map(
    (match) => match[1]
  );
}

function requireExperimentField(block, label, experimentId, documentPath, errors) {
  const values = fieldValues(block, label);
  if (values.length !== 1) {
    errors.push(`${documentPath}: experiment ${experimentId} requires exactly one ${label} field`);
    return null;
  }
  return values[0];
}

function validateExperiments(documents, registry, errors) {
  const seenExperimentIds = new Set();

  for (const document of documents) {
    const fileName = path.basename(document.path);
    const monthMatch = /^(\d{4})-(\d{2})\.md$/.exec(fileName);
    if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) {
      errors.push(`${document.path}: experiment log filename must be YYYY-MM.md`);
      continue;
    }

    const experimentSections = [];
    for (const section of secondLevelSections(document.text)) {
      if (!/^Experiment(?:\s|$)/i.test(section.title)) continue;
      const headingMatch = /^Experiment `([^`]+)`\s*$/.exec(section.title);
      if (!headingMatch) {
        // Experiment-like headings fail closed instead of disappearing from validation. This
        // branch originates from https://github.com/yydspanda/obsidian-copilot/issues/1.
        errors.push(`${document.path}: invalid experiment heading \`## ${section.title}\``);
        continue;
      }
      experimentSections.push({ ...section, experimentId: headingMatch[1] });
    }
    if (experimentSections.length === 0) {
      errors.push(`${document.path}: experiment log must contain at least one experiment block`);
      continue;
    }

    // An experiment owns only its H2 section, so fields in Notes or a later template cannot fill
    // an incomplete record. This fail-closed boundary originates from
    // https://github.com/yydspanda/obsidian-copilot/issues/1.
    for (const section of experimentSections) {
      const experimentId = section.experimentId;
      const block = section.body;
      const experimentMatch = EXPERIMENT_ID_PATTERN.exec(experimentId);

      if (!experimentMatch) {
        errors.push(`${document.path}: invalid experiment ID \`${experimentId}\``);
      } else if (experimentMatch[1] !== monthMatch[1] || experimentMatch[2] !== monthMatch[2]) {
        errors.push(`${document.path}: experiment ${experimentId} does not match the log month`);
      }
      if (seenExperimentIds.has(experimentId)) {
        errors.push(`${document.path}: duplicate experiment ID \`${experimentId}\``);
      }
      seenExperimentIds.add(experimentId);

      const taskId = requireExperimentField(block, "Task ID", experimentId, document.path, errors);
      const upstreamCommit = requireExperimentField(
        block,
        "Upstream commit",
        experimentId,
        document.path,
        errors
      );
      requireExperimentField(block, "Model", experimentId, document.path, errors);
      const modelConfigHash = requireExperimentField(
        block,
        "Model config hash",
        experimentId,
        document.path,
        errors
      );
      const dataHash = requireExperimentField(
        block,
        "Data hash",
        experimentId,
        document.path,
        errors
      );
      requireExperimentField(block, "Hardware", experimentId, document.path, errors);
      requireExperimentField(block, "Command", experimentId, document.path, errors);
      requireExperimentField(block, "Metrics", experimentId, document.path, errors);

      if (taskId && !registry.taskIds.has(taskId)) {
        errors.push(
          `${document.path}: experiment ${experimentId} references unknown Task ID \`${taskId}\``
        );
      }
      if (upstreamCommit && !COMMIT_PATTERN.test(upstreamCommit)) {
        errors.push(`${document.path}: experiment ${experimentId} has an invalid upstream commit`);
      }
      if (modelConfigHash && !SHA256_PATTERN.test(modelConfigHash)) {
        errors.push(
          `${document.path}: experiment ${experimentId} has an invalid model config hash`
        );
      }
      if (dataHash && !SHA256_PATTERN.test(dataHash)) {
        errors.push(`${document.path}: experiment ${experimentId} has an invalid data hash`);
      }
    }
  }
}

/**
 * Validates the repository's live progress control plane without reading global state.
 * The fail-closed governance branches originate from
 * https://github.com/yydspanda/obsidian-copilot/issues/1.
 *
 * @param documents Progress, roadmap, archive, and experiment contents plus configured limits.
 * @returns Stable human-readable validation errors; an empty array means the contract holds.
 */
export function validateProgressDocuments(documents) {
  const errors = [];
  const registry = registeredIds(documents.roadmap.text, documents.roadmap.path, errors);
  validateTracker(documents.tracker, registry, documents.limits, errors);
  validateArchives(documents.archives, registry, errors);
  validateExperiments(documents.experiments, registry, errors);
  return errors;
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --flag value pairs, received ${flag ?? "<nothing>"}`);
    }
    values.set(flag, value);
  }

  const required = ["--tracker", "--roadmap", "--archive-dir", "--experiment-dir"];
  for (const flag of required) {
    if (!values.has(flag)) throw new Error(`Missing required argument ${flag}`);
  }

  const maxTrackerLines = Number(values.get("--max-tracker-lines") ?? "120");
  const maxRecentActivity = Number(values.get("--max-recent-activity") ?? "10");
  if (!Number.isSafeInteger(maxTrackerLines) || maxTrackerLines < 1) {
    throw new Error("--max-tracker-lines must be a positive integer");
  }
  if (!Number.isSafeInteger(maxRecentActivity) || maxRecentActivity < 1) {
    throw new Error("--max-recent-activity must be a positive integer");
  }

  return {
    trackerPath: values.get("--tracker"),
    roadmapPath: values.get("--roadmap"),
    archiveDirectory: values.get("--archive-dir"),
    experimentDirectory: values.get("--experiment-dir"),
    maxTrackerLines,
    maxRecentActivity,
  };
}

async function readMarkdownDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        return { path: filePath, text: await readFile(filePath, "utf8") };
      })
  );
}

async function run(arguments_) {
  const options = parseArguments(arguments_);
  const [trackerText, roadmapText, archives, experiments] = await Promise.all([
    readFile(options.trackerPath, "utf8"),
    readFile(options.roadmapPath, "utf8"),
    readMarkdownDirectory(options.archiveDirectory),
    readMarkdownDirectory(options.experimentDirectory),
  ]);
  const errors = validateProgressDocuments({
    tracker: { path: options.trackerPath, text: trackerText },
    roadmap: { path: options.roadmapPath, text: roadmapText },
    archives,
    experiments,
    limits: {
      maxTrackerLines: options.maxTrackerLines,
      maxRecentActivity: options.maxRecentActivity,
    },
  });

  if (errors.length > 0) {
    process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Progress governance passed: ${options.trackerPath}, ${archives.length} archive(s), ${experiments.length} experiment log(s).\n`
  );
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (executedPath === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
