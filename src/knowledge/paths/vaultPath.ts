const WINDOWS_DRIVE_PREFIX_PATTERN = /^[a-z]:/i;
const WINDOWS_INVALID_SEGMENT_PATTERN = /[<>:"|?*]/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;

/** Stable issue codes returned by the Vault path parser. */
export type VaultPathIssueCode =
  | "path_required"
  | "path_absolute"
  | "path_backslash"
  | "path_empty_segment"
  | "path_traversal"
  | "path_invalid_windows_character"
  | "path_windows_reserved_name"
  | "path_windows_trailing_character";

/** One deterministic validation issue for a Vault-relative path. */
export interface VaultPathIssue {
  code: VaultPathIssueCode;
  message: string;
  segmentIndex?: number;
}

/** A valid, canonical Vault-relative path and its original segments. */
export interface ValidVaultPath {
  ok: true;
  path: string;
  segments: readonly string[];
}

/** Validation issues for a path that cannot be used as a Vault-relative path. */
export interface InvalidVaultPath {
  ok: false;
  issues: readonly VaultPathIssue[];
}

/** Public parse result that does not expose a validation-library implementation. */
export type VaultPathParseResult = ValidVaultPath | InvalidVaultPath;

/** Paths that resolve to the same comparison key on Windows. */
export interface WindowsPathCollision {
  key: string;
  paths: readonly string[];
}

/**
 * Appends one path issue without coupling callers to a schema library.
 *
 * @param issues - Mutable issue collection for the current parse
 * @param code - Stable machine-readable issue code
 * @param message - Human-readable explanation
 * @param segmentIndex - Optional index of the invalid path segment
 */
function addIssue(
  issues: VaultPathIssue[],
  code: VaultPathIssueCode,
  message: string,
  segmentIndex?: number
): void {
  issues.push({ code, message, ...(segmentIndex === undefined ? {} : { segmentIndex }) });
}

/**
 * Detects native absolute or drive-qualified paths before segment validation.
 *
 * @param input - Untrusted path text
 * @returns Whether the input carries absolute Windows, UNC, or POSIX syntax
 */
function isNativeAbsolutePath(input: string): boolean {
  return (
    input.startsWith("/") || input.startsWith("\\") || WINDOWS_DRIVE_PREFIX_PATTERN.test(input)
  );
}

/**
 * Detects Windows punctuation and ASCII control characters forbidden in a path segment.
 *
 * @param segment - One Vault path segment
 * @returns Whether Windows forbids at least one character in the segment
 */
function hasWindowsInvalidCharacter(segment: string): boolean {
  if (WINDOWS_INVALID_SEGMENT_PATTERN.test(segment)) {
    return true;
  }
  for (let index = 0; index < segment.length; index += 1) {
    if (segment.charCodeAt(index) <= 0x1f) {
      return true;
    }
  }
  return false;
}

/**
 * Parses and validates one canonical Vault-relative path for a Windows Vault.
 *
 * Valid paths retain their original spelling and use forward slashes. This
 * function never repairs native paths because silently accepting backslashes or
 * traversal would make write-boundary checks ambiguous.
 *
 * @param input - Untrusted path value
 * @returns Either the original canonical path or deterministic validation issues
 */
export function parseVaultPath(input: unknown): VaultPathParseResult {
  if (typeof input !== "string" || input.length === 0) {
    return {
      ok: false,
      issues: [{ code: "path_required", message: "Expected a non-empty Vault-relative path" }],
    };
  }

  const issues: VaultPathIssue[] = [];
  if (isNativeAbsolutePath(input)) {
    addIssue(issues, "path_absolute", "Expected a Vault-relative path, not a native absolute path");
  }
  if (input.includes("\\")) {
    addIssue(issues, "path_backslash", "Vault paths must use forward slashes");
  }

  const segments = input.split("/");
  segments.forEach((segment, segmentIndex) => {
    if (segment.length === 0) {
      addIssue(issues, "path_empty_segment", "Path cannot contain empty segments", segmentIndex);
      return;
    }
    if (segment === "." || segment === "..") {
      addIssue(
        issues,
        "path_traversal",
        "Dot and traversal segments are not allowed",
        segmentIndex
      );
    }
    if (hasWindowsInvalidCharacter(segment)) {
      addIssue(
        issues,
        "path_invalid_windows_character",
        "Path segment contains a character that Windows does not allow",
        segmentIndex
      );
    }
    if (WINDOWS_RESERVED_NAME_PATTERN.test(segment)) {
      addIssue(
        issues,
        "path_windows_reserved_name",
        "Path segment uses a Windows-reserved device name",
        segmentIndex
      );
    }
    if (/[. ]$/.test(segment)) {
      addIssue(
        issues,
        "path_windows_trailing_character",
        "Windows path segments cannot end in a dot or space",
        segmentIndex
      );
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, path: input, segments };
}

/**
 * Produces a Windows-style comparison key for a path-like string.
 *
 * Separator conversion here is only for comparison and must not be used to
 * accept input: {@link parseVaultPath} deliberately rejects backslashes.
 *
 * @param path - Path-like string to compare
 * @returns Forward-slash, NFC-normalized, case-insensitive comparison key
 */
export function toWindowsPathKey(path: string): string {
  return path.replace(/\\/g, "/").normalize("NFC").toLowerCase().normalize("NFC");
}

/**
 * Tests whether a valid Vault path is equal to or nested below a valid root.
 *
 * @param path - Candidate Vault-relative path
 * @param root - Vault-relative root path
 * @returns Whether the path lies within the root under Windows comparison rules
 */
export function isPathWithinRoot(path: string, root: string): boolean {
  const parsedPath = parseVaultPath(path);
  const parsedRoot = parseVaultPath(root);
  if (!parsedPath.ok || !parsedRoot.ok) {
    return false;
  }

  const pathKey = toWindowsPathKey(parsedPath.path);
  const rootKey = toWindowsPathKey(parsedRoot.path);
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}

/**
 * Finds duplicate Windows targets while retaining input order and spelling.
 *
 * The function creates comparison keys only; callers should independently use
 * {@link parseVaultPath} before accepting any path for a Vault operation.
 *
 * @param paths - Path-like strings that may target the same Windows file
 * @returns Collision groups in first-seen key order
 */
export function findWindowsPathCollisions(paths: readonly string[]): WindowsPathCollision[] {
  const pathsByKey = new Map<string, string[]>();
  for (const path of paths) {
    const key = toWindowsPathKey(path);
    const matchingPaths = pathsByKey.get(key);
    if (matchingPaths) {
      matchingPaths.push(path);
    } else {
      pathsByKey.set(key, [path]);
    }
  }

  const collisions: WindowsPathCollision[] = [];
  for (const [key, matchingPaths] of pathsByKey) {
    if (matchingPaths.length > 1) {
      collisions.push({ key, paths: matchingPaths });
    }
  }
  return collisions;
}
