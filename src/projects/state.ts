import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileRecord } from "@/projects/type";
import { normalizePath } from "obsidian";

const projectsStore = createStore();

const projectRecordsAtom = atom<ProjectFileRecord[]>([]);

declare const projectStateOwnerBrand: unique symbol;
declare const projectFileWriteLeaseBrand: unique symbol;

export interface ProjectStateOwner {
  readonly [projectStateOwnerBrand]: never;
}

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

const legacyPendingFileWrites = new Map<string, number>();

function createProjectStateOwner(): ProjectStateOwner {
  return Object.freeze({}) as ProjectStateOwner;
}

function createProjectFileWriteLease(): ProjectFileWriteLease {
  return Object.freeze({}) as ProjectFileWriteLease;
}

function clearProjectState(): void {
  projectsStore.set(projectRecordsAtom, []);
  projectFileWriteLeases.clear();
  projectFileWriteLeasesByPath.clear();
  legacyPendingFileWrites.clear();
}

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

export function beginProjectStateLifecycle(): ProjectStateOwner {
  const owner = createProjectStateOwner();
  projectStateOwnershipActivated = true;
  activeProjectStateOwner = owner;
  clearProjectState();
  return owner;
}

export function releaseProjectStateLifecycle(owner: ProjectStateOwner): boolean {
  if (owner !== activeProjectStateOwner) {
    return false;
  }

  activeProjectStateOwner = undefined;
  clearProjectState();
  return true;
}

export function isProjectStateOwnerActive(owner: ProjectStateOwner): boolean {
  return owner === activeProjectStateOwner;
}

const projectConfigsAtom = atom<ProjectConfig[]>((get) =>
  get(projectRecordsAtom).map((r) => r.project)
);

export function useProjects(): ProjectConfig[] {
  return useAtomValue(projectConfigsAtom, { store: projectsStore });
}

export function getCachedProjectRecords(): ProjectFileRecord[] {
  return projectsStore.get(projectRecordsAtom);
}

export function getCachedProjectRecordById(projectId: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.project.id === projectId);
}

export function getCachedProjectRecordByFilePath(filePath: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.filePath === filePath);
}

export function updateCachedProjectRecordsForOwner(
  owner: ProjectStateOwner,
  records: ProjectFileRecord[]
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, () => records);
}

export function updateCachedProjectRecords(records: ProjectFileRecord[]): void {
  if (projectStateOwnershipActivated) {
    return;
  }
  projectsStore.set(projectRecordsAtom, records);
}

export function replaceCachedProjectRecordByFilePathForOwner(
  owner: ProjectStateOwner,
  filePath: string,
  record: ProjectFileRecord
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (prev) =>
    replaceProjectRecordByFilePath(prev, filePath, record)
  );
}

function replaceProjectRecordByFilePath(
  prev: ProjectFileRecord[],
  filePath: string,
  record: ProjectFileRecord
): ProjectFileRecord[] {
  const existingIndex = prev.findIndex((candidate) => candidate.filePath === filePath);

  if (existingIndex === -1) {
    const withoutId = prev.filter((candidate) => candidate.project.id !== record.project.id);
    return [...withoutId, record];
  }

  const updated = prev.filter(
    (candidate, index) => index === existingIndex || candidate.project.id !== record.project.id
  );
  const newIndex = updated.findIndex((candidate) => candidate.filePath === filePath);
  updated[newIndex] = record;
  return updated;
}

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

export function upsertCachedProjectRecordForOwner(
  owner: ProjectStateOwner,
  record: ProjectFileRecord
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    upsertProjectRecord(records, record)
  );
}

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

export function upsertCachedProjectRecord(record: ProjectFileRecord): void {
  if (projectStateOwnershipActivated) {
    return;
  }

  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(projectRecordsAtom, upsertProjectRecord(records, record));
}

export function deleteCachedProjectRecordByIdForOwner(
  owner: ProjectStateOwner,
  projectId: string
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    records.filter((record) => record.project.id !== projectId)
  );
}

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

export function deleteCachedProjectRecordByFilePathForOwner(
  owner: ProjectStateOwner,
  filePath: string
): boolean {
  return mutateCachedProjectRecordsForOwner(owner, (records) =>
    records.filter((record) => record.filePath !== filePath)
  );
}

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

export function subscribeToProjectRecords(
  callback: (records: ProjectFileRecord[]) => void
): () => void {
  return projectsStore.sub(projectRecordsAtom, () => {
    callback(projectsStore.get(projectRecordsAtom));
  });
}

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

export function addPendingFileWrite(path: string): void {
  const key = normalizePath(path);
  legacyPendingFileWrites.set(key, (legacyPendingFileWrites.get(key) ?? 0) + 1);
}

export function removePendingFileWrite(path: string): void {
  const key = normalizePath(path);
  const count = (legacyPendingFileWrites.get(key) ?? 0) - 1;
  if (count <= 0) {
    legacyPendingFileWrites.delete(key);
  } else {
    legacyPendingFileWrites.set(key, count);
  }
}

export function isPendingFileWrite(path: string): boolean {
  const key = normalizePath(path);
  return (
    (projectFileWriteLeasesByPath.get(key)?.size ?? 0) > 0 ||
    (legacyPendingFileWrites.get(key) ?? 0) > 0
  );
}
