const WINDOWS_DRIVE_PREFIX_PATTERN = /^[a-z]:/i;
const WINDOWS_INVALID_SEGMENT_PATTERN = /[<>:"|?*]/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;

export type VaultPathIssueCode =
  | "path_required"
  | "path_absolute"
  | "path_backslash"
  | "path_empty_segment"
  | "path_traversal"
  | "path_invalid_windows_character"
  | "path_windows_reserved_name"
  | "path_windows_trailing_character";

export interface VaultPathIssue {
  code: VaultPathIssueCode;
  message: string;
  segmentIndex?: number;
}

export interface ValidVaultPath {
  ok: true;
  path: string;
  segments: readonly string[];
}

export interface InvalidVaultPath {
  ok: false;
  issues: readonly VaultPathIssue[];
}

export type VaultPathParseResult = ValidVaultPath | InvalidVaultPath;

export interface WindowsPathCollision {
  key: string;
  paths: readonly string[];
}

function addIssue(
  issues: VaultPathIssue[],
  code: VaultPathIssueCode,
  message: string,
  segmentIndex?: number
): void {
  issues.push({ code, message, ...(segmentIndex === undefined ? {} : { segmentIndex }) });
}

function isNativeAbsolutePath(input: string): boolean {
  return (
    input.startsWith("/") || input.startsWith("\\") || WINDOWS_DRIVE_PREFIX_PATTERN.test(input)
  );
}

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

export function toWindowsPathKey(path: string): string {
  return path.replace(/\\/g, "/").normalize("NFC").toLowerCase().normalize("NFC");
}

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
