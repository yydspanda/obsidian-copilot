import { appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EMPTY_REASONS = Object.freeze([]);
const ALIGNED_RESULT = Object.freeze({ level: "pass", reasons: EMPTY_REASONS });

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/**
 * Classifies canonical-upstream drift independently from Git or GitHub Actions.
 * Warning/failure boundaries originate from
 * https://github.com/yydspanda/obsidian-copilot/issues/1.
 *
 * @param observation Ahead/behind counts, oldest missing age, and configured thresholds.
 * @returns The stable policy level and the reasons that produced it.
 */
export function evaluateUpstreamDrift(observation) {
  requireNonNegativeInteger(observation.ahead, "ahead");
  requireNonNegativeInteger(observation.behind, "behind");
  requireNonNegativeInteger(observation.maxBehind, "maxBehind");
  if (observation.maxBehind === 0) throw new Error("maxBehind must be greater than zero");
  if (!Number.isFinite(observation.maxAgeDays) || observation.maxAgeDays < 0) {
    throw new Error("maxAgeDays must be a non-negative finite number");
  }
  if (
    observation.oldestMissingAgeDays !== null &&
    (!Number.isFinite(observation.oldestMissingAgeDays) || observation.oldestMissingAgeDays < 0)
  ) {
    throw new Error("oldestMissingAgeDays must be null or a non-negative finite number");
  }
  if (observation.behind > 0 && observation.oldestMissingAgeDays === null) {
    throw new Error("a behind branch must include the oldest missing commit age");
  }

  const reasons = [];
  if (observation.behind >= observation.maxBehind) {
    reasons.push(`behind ${observation.behind} commits (limit ${observation.maxBehind - 1})`);
  }
  if (
    observation.oldestMissingAgeDays !== null &&
    observation.oldestMissingAgeDays > observation.maxAgeDays
  ) {
    reasons.push(
      `oldest missing commit is ${observation.oldestMissingAgeDays.toFixed(2)} days old (limit ${observation.maxAgeDays})`
    );
  }

  if (reasons.length > 0) return Object.freeze({ level: "fail", reasons: Object.freeze(reasons) });
  if (observation.behind > 0) {
    return Object.freeze({
      level: "warn",
      reasons: Object.freeze([`behind ${observation.behind} commit(s)`]),
    });
  }
  return ALIGNED_RESULT;
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

  const required = [
    "--branch",
    "--ahead",
    "--behind",
    "--upstream-sha",
    "--downstream-sha",
    "--oldest-missing-epoch",
    "--now-epoch",
    "--max-behind",
    "--max-age-days",
  ];
  for (const flag of required) {
    if (!values.has(flag)) throw new Error(`Missing required argument ${flag}`);
  }
  return values;
}

function numericArgument(values, flag) {
  const value = Number(values.get(flag));
  if (!Number.isFinite(value)) throw new Error(`${flag} must be numeric`);
  return value;
}

async function run(arguments_) {
  const values = parseArguments(arguments_);
  const ahead = numericArgument(values, "--ahead");
  const behind = numericArgument(values, "--behind");
  const oldestMissingEpoch = numericArgument(values, "--oldest-missing-epoch");
  const nowEpoch = numericArgument(values, "--now-epoch");
  if (nowEpoch < oldestMissingEpoch)
    throw new Error("--now-epoch cannot precede the missing commit");

  const oldestMissingAgeDays =
    behind === 0 ? null : (nowEpoch - oldestMissingEpoch) / (24 * 60 * 60);
  const result = evaluateUpstreamDrift({
    ahead,
    behind,
    oldestMissingAgeDays,
    maxBehind: numericArgument(values, "--max-behind"),
    maxAgeDays: numericArgument(values, "--max-age-days"),
  });
  const branch = values.get("--branch");
  const reason = result.reasons.join("; ") || "aligned with canonical upstream";
  const message = `${branch}: ahead=${ahead}, behind=${behind}; ${reason}`;

  if (result.level === "warn") {
    process.stdout.write(`::warning title=Upstream drift::${message}\n`);
  } else if (result.level === "fail") {
    process.stderr.write(`::error title=Upstream drift::${message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${message}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `| ${branch} | ${values.get("--downstream-sha")} | ${values.get("--upstream-sha")} | ${ahead} | ${behind} | ${result.level} |\n`
    );
  }
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (executedPath === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
