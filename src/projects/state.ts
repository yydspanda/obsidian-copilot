import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileRecord } from "@/projects/type";
import { normalizePath } from "obsidian";

// Independent store for projects (aligned with system-prompts pattern)
const projectsStore = createStore();

const projectRecordsAtom = atom<ProjectFileRecord[]>([]);

declare const projectStateOwnerBrand: unique symbol;
declare const projectFileWriteLeaseBrand: unique symbol;

/**
 * Opaque ownership token for one active Projects state lifecycle.
 *
 * Tokens can only be obtained from {@link beginProjectStateLifecycle}. Runtime
 * ownership is determined by object identity so an earlier asynchronous lifecycle
 * cannot commit into a newer lifecycle.
 */
export interface ProjectStateOwner {
  readonly [projectStateOwnerBrand]: never;
}

/**
 * Opaque lease for one pending project-file write.
 *
 * A lease belongs to the lifecycle owner that acquired it and can be released
 * exactly once without affecting another write to the same normalized path.
 */
export interface ProjectFileWriteLease {
  readonly [projectFileWriteLeaseBrand]: never;
}

interface ProjectFileWriteLeaseRecord {
  owner: ProjectStateOwner;
  path: string;
}

let activeProjectStateOwner: ProjectStateOwner | undefined;
let projectStateOwnershipActivated = false;
const projectFileWriteLeases = new Map<ProjectFileWriteLease, ProjectFileWriteLeaseRecord>();
const projectFileWriteLeasesByPath = new Map<string, Set<ProjectFileWriteLease>>();

// Compatibility counters remain available to upstream helpers that cannot retain opaque leases.
const legacyPendingFileWrites = new Map<string, number>();

/**
 * Creates an opaque project state owner.
 *
 * @returns A new identity-only lifecycle owner
 */
function createProjectStateOwner(): ProjectStateOwner {
  return Object.freeze({}) as ProjectStateOwner;
}

/**
 * Creates an opaque pending-write lease.
 *
 * @returns A new identity-only write lease
 */
function createProjectFileWriteLease(): ProjectFileWriteLease {
  return Object.freeze({}) as ProjectFileWriteLease;
}

/**
 * Clears all state that belongs to the active or just-released lifecycle.
 */
function clearProjectState(): void {
  projectsStore.set(projectRecordsAtom, []);
  projectFileWriteLeases.clear();
  projectFileWriteLeasesByPath.clear();
  legacyPendingFileWrites.clear();
}

/**
 * Runs a project-record mutation only when the caller still owns the active lifecycle.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param mutate - Pure record transformation to commit
 * @returns Whether the mutation was committed
 */
function mutateCachedProjectRecordsForOwner(
  owner: ProjectStateOwner,
  mutate: (records: ProjectFileRecord[]) => ProjectFileRecord[]
): boolean {
  if (owner !== activeProjectStateOwner) {
    return false;
  }

  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(projectRecordsAtom, mutate(records));
  return true;
}

/**
 * Starts a new Projects state lifecycle and invalidates all earlier ownership.
 *
 * Project records and every pending-write guard are cleared synchronously before
 * this function returns.
 *
 * @returns Opaque owner required for all mutations in this lifecycle
 */
export function beginProjectStateLifecycle(): ProjectStateOwner {
  const owner = createProjectStateOwner();
  projectStateOwnershipActivated = true;
  activeProjectStateOwner = owner;
  clearProjectState();
  return owner;
}

/**
 * Releases a Projects state lifecycle only if it is still the active owner.
 *
 * Compare-and-release prevents a delayed cleanup from an earlier lifecycle from
 * clearing records or pending-write guards owned by a newer lifecycle.
 *
 * @param owner - Lifecycle owner attempting release
 * @returns Whether the active lifecycle was released
 */
export function releaseProjectStateLifecycle(owner: ProjectStateOwner): boolean {
  if (owner !== activeProjectStateOwner) {
    return false;
  }

  activeProjectStateOwner = undefined;
  clearProjectState();
  return true;
}

/**
 * Reports whether an owner still controls the active Projects state lifecycle.
 *
 * @param owner - Lifecycle owner to inspect
 * @returns Whether the owner is current
 */
export function isProjectStateOwnerActive(owner: ProjectStateOwner): boolean {
  return owner === activeProjectStateOwner;
}

// Reason: derived atom so that useProjects() returns a stable array reference
// (only recomputed when projectRecordsAtom changes, not on every parent render).
const projectConfigsAtom = atom<ProjectConfig[]>((get) =>
  get(projectRecordsAtom).map((r) => r.project)
);

/**
 * React hook: get all ProjectConfig objects (convenience wrapper).
 * Uses a derived atom so the array reference is stable across re-renders.
 * @returns Array of ProjectConfig
 */
export function useProjects(): ProjectConfig[] {
  return useAtomValue(projectConfigsAtom, { store: projectsStore });
}

/**
 * Non-reactive: get cached project records.
 * @returns Array of ProjectFileRecord
 */
export function getCachedProjectRecords(): ProjectFileRecord[] {
  return projectsStore.get(projectRecordsAtom);
}

/**
 * Non-reactive: get cached ProjectConfig objects.
 * @returns Array of ProjectConfig
 */
export function getCachedProjects(): ProjectConfig[] {
  return projectsStore.get(projectRecordsAtom).map((r) => r.project);
}

/**
 * Non-reactive: find a cached record by project id.
 * @param projectId - Project id to look up
 * @returns Matching record or undefined
 */
export function getCachedProjectRecordById(projectId: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.project.id === projectId);
}

/**
 * Non-reactive: find a cached record by file path.
 * @param filePath - Vault path of the project.md metadata/config record
 * @returns Matching record or undefined
 */
export function getCachedProjectRecordByFilePath(filePath: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.filePath === filePath);
}

/**
 * Replace all cached project records for the active lifecycle owner.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param records - New array of ProjectFileRecord
 * @returns Whether the records were committed
 */
export function updateCachedProjectRecordsForOwner(
  owner: ProjectStateOwner,
  records: ProjectFileRecord[]
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, () => records);
}

/**
 * Replace all cached project records.
 *
 * This compatibility wrapper works only until explicit lifecycle ownership is
 * activated. Afterwards, unowned writes are deterministic no-ops.
 *
 * @param records - New array of ProjectFileRecord
 */
export function updateCachedProjectRecords(records: ProjectFileRecord[]): void {
  if (projectStateOwnershipActivated) {
    return;
  }
  projectsStore.set(projectRecordsAtom, records);
}

/**
 * Replace the cached record for a file path within the active lifecycle.
 *
 * Avoids transient "disappear/reappear" gaps for subscribers during modify events,
 * while still cleaning up stale entries when the frontmatter id changes.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param filePath - Vault path of project.md being modified
 * @param record - Parsed record to store for that file
 * @returns Whether the record was committed
 */
export function replaceCachedProjectRecordByFilePathForOwner(
  owner: ProjectStateOwner,
  filePath: string,
  record: ProjectFileRecord
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (prev) =>
    replaceProjectRecordByFilePath(prev, filePath, record)
  );
}

/**
 * Computes a cache replacement by file path while preserving existing array order.
 *
 * @param prev - Existing cached records
 * @param filePath - Vault path being replaced
 * @param record - Parsed replacement record
 * @returns Updated records
 */
function replaceProjectRecordByFilePath(
  prev: ProjectFileRecord[],
  filePath: string,
  record: ProjectFileRecord
): ProjectFileRecord[] {
  // Reason: find the original index by filePath to preserve array order (avoid moving to end on
  // every modify). If the record exists, replace in-place; otherwise append.
  const existingIndex = prev.findIndex((candidate) => candidate.filePath === filePath);

  if (existingIndex === -1) {
    // New filePath: remove any stale id match, then append.
    const withoutId = prev.filter((candidate) => candidate.project.id !== record.project.id);
    return [...withoutId, record];
  }

  // Reason: also remove any other entry with the same id but different filePath (stale duplicate),
  // then replace in-place at the original position.
  const updated = prev.filter(
    (candidate, index) => index === existingIndex || candidate.project.id !== record.project.id
  );
  const newIndex = updated.findIndex((candidate) => candidate.filePath === filePath);
  updated[newIndex] = record;
  return updated;
}

/**
 * Replace the cached record for a given file path in a single store write.
 *
 * This compatibility wrapper works only until explicit lifecycle ownership is
 * activated. Afterwards, unowned writes are deterministic no-ops.
 *
 * @param filePath - Vault path of the project.md metadata/config record being modified
 * @param record - Parsed record to store for that file
 */
export function replaceCachedProjectRecordByFilePath(
  filePath: string,
  record: ProjectFileRecord
): void {
  if (projectStateOwnershipActivated) {
    return;
  }

  const prev = projectsStore.get(projectRecordsAtom);
  projectsStore.set(projectRecordsAtom, replaceProjectRecordByFilePath(prev, filePath, record));
}

/**
 * Add or update a project record by project id for the active lifecycle owner.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param record - ProjectFileRecord to upsert
 * @returns Whether the record was committed
 */
export function upsertCachedProjectRecordForOwner(
  owner: ProjectStateOwner,
  record: ProjectFileRecord
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    upsertProjectRecord(records, record)
  );
}

/**
 * Computes a cache upsert by project id.
 *
 * @param records - Existing cached records
 * @param record - Record to add or replace
 * @returns Updated records
 */
function upsertProjectRecord(
  records: ProjectFileRecord[],
  record: ProjectFileRecord
): ProjectFileRecord[] {
  const existingIndex = records.findIndex(
    (candidate) => candidate.project.id === record.project.id
  );

  if (existingIndex !== -1) {
    const updated = [...records];
    updated[existingIndex] = record;
    return updated;
  }
  return [...records, record];
}

/**
 * Add or update a project record by project id.
 *
 * This compatibility wrapper works only until explicit lifecycle ownership is
 * activated. Afterwards, unowned writes are deterministic no-ops.
 *
 * @param record - ProjectFileRecord to upsert
 */
export function upsertCachedProjectRecord(record: ProjectFileRecord): void {
  if (projectStateOwnershipActivated) {
    return;
  }

  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(projectRecordsAtom, upsertProjectRecord(records, record));
}

/**
 * Remove a project record by project id for the active lifecycle owner.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param projectId - Project id to remove
 * @returns Whether the mutation was committed
 */
export function deleteCachedProjectRecordByIdForOwner(
  owner: ProjectStateOwner,
  projectId: string
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    records.filter((record) => record.project.id !== projectId)
  );
}

/**
 * Remove a project record by project id.
 *
 * This compatibility wrapper works only until explicit lifecycle ownership is
 * activated. Afterwards, unowned writes are deterministic no-ops.
 *
 * @param projectId - Project id to remove
 */
export function deleteCachedProjectRecordById(projectId: string): void {
  if (projectStateOwnershipActivated) {
    return;
  }

  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.project.id !== projectId)
  );
}

/**
 * Remove a project record by file path for the active lifecycle owner.
 *
 * @param owner - Lifecycle owner attempting the mutation
 * @param filePath - Vault path of project.md
 * @returns Whether the mutation was committed
 */
export function deleteCachedProjectRecordByFilePathForOwner(
  owner: ProjectStateOwner,
  filePath: string
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    records.filter((record) => record.filePath !== filePath)
  );
}

/**
 * Remove a project record by file path (used for delete/rename events).
 *
 * This compatibility wrapper works only until explicit lifecycle ownership is
 * activated. Afterwards, unowned writes are deterministic no-ops.
 *
 * @param filePath - Vault path of the project.md metadata/config record
 */
export function deleteCachedProjectRecordByFilePath(filePath: string): void {
  if (projectStateOwnershipActivated) {
    return;
  }

  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.filePath !== filePath)
  );
}

/**
 * Subscribe to project records changes (for non-React code).
 * Returns an unsubscribe function.
 * @param callback - Called with the new records array whenever it changes
 * @returns Unsubscribe function
 */
export function subscribeToProjectRecords(
  callback: (records: ProjectFileRecord[]) => void
): () => void {
  return projectsStore.sub(projectRecordsAtom, () => {
    callback(projectsStore.get(projectRecordsAtom));
  });
}

/**
 * Acquires an owner-bound pending-write lease for a normalized Vault path.
 *
 * @param owner - Active lifecycle owner acquiring the lease
 * @param path - Vault path being written
 * @returns Opaque lease, or undefined when the owner is stale
 */
export function acquireProjectFileWrite(
  owner: ProjectStateOwner,
  path: string
): ProjectFileWriteLease | undefined {
  if (owner !== activeProjectStateOwner) {
    return undefined;
  }

  const key = normalizePath(path);
  const lease = createProjectFileWriteLease();
  projectFileWriteLeases.set(lease, { owner, path: key });

  const leasesForPath = projectFileWriteLeasesByPath.get(key);
  if (leasesForPath) {
    leasesForPath.add(lease);
  } else {
    projectFileWriteLeasesByPath.set(key, new Set([lease]));
  }

  return lease;
}

/**
 * Releases a pending-write lease exactly once.
 *
 * Stale, unknown, or already-released leases are deterministic no-ops. In
 * particular, a delayed old lease cannot decrement a newer lifecycle's guard
 * for the same path.
 *
 * @param lease - Opaque lease returned by {@link acquireProjectFileWrite}
 * @returns Whether a current pending-write lease was released
 */
export function releaseProjectFileWrite(lease: ProjectFileWriteLease): boolean {
  const record = projectFileWriteLeases.get(lease);
  if (!record || record.owner !== activeProjectStateOwner) {
    return false;
  }

  projectFileWriteLeases.delete(lease);
  const leasesForPath = projectFileWriteLeasesByPath.get(record.path);
  if (!leasesForPath) {
    return false;
  }

  leasesForPath.delete(lease);
  if (leasesForPath.size === 0) {
    projectFileWriteLeasesByPath.delete(record.path);
  }
  return true;
}

/**
 * Mark a file path as pending write.
 *
 * Lifecycle-aware callers should retain an opaque lease from
 * {@link acquireProjectFileWrite}; this wrapper remains for bounded upstream helpers.
 *
 * @param path - Vault path being written
 */
export function addPendingFileWrite(path: string): void {
  const key = normalizePath(path);
  legacyPendingFileWrites.set(key, (legacyPendingFileWrites.get(key) ?? 0) + 1);
}

/**
 * Remove a file path from compatibility pending writes.
 *
 * This compatibility wrapper never releases owner-bound leases.
 *
 * @param path - Vault path whose compatibility guard should be decremented
 */
export function removePendingFileWrite(path: string): void {
  const key = normalizePath(path);
  const count = (legacyPendingFileWrites.get(key) ?? 0) - 1;
  if (count <= 0) {
    legacyPendingFileWrites.delete(key);
  } else {
    legacyPendingFileWrites.set(key, count);
  }
}

/**
 * Check if a file path has any current pending-write guard.
 *
 * @param path - Vault path to inspect
 * @returns Whether the path has an owner-bound or compatibility guard
 */
export function isPendingFileWrite(path: string): boolean {
  const key = normalizePath(path);
  return (
    (projectFileWriteLeasesByPath.get(key)?.size ?? 0) > 0 ||
    (legacyPendingFileWrites.get(key) ?? 0) > 0
  );
}
