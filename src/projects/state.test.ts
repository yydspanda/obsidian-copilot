import { ProjectConfig } from "@/aiParams";
import {
  acquireProjectFileWrite,
  addPendingFileWrite,
  beginProjectStateLifecycle,
  deleteCachedProjectRecordByFilePath,
  deleteCachedProjectRecordByFilePathForOwner,
  deleteCachedProjectRecordById,
  deleteCachedProjectRecordByIdForOwner,
  getCachedProjectRecords,
  isPendingFileWrite,
  isProjectStateOwnerActive,
  releaseProjectFileWrite,
  releaseProjectStateLifecycle,
  removePendingFileWrite,
  replaceCachedProjectRecordByFilePath,
  replaceCachedProjectRecordByFilePathForOwner,
  updateCachedProjectRecords,
  updateCachedProjectRecordsForOwner,
  upsertCachedProjectRecord,
  upsertCachedProjectRecordForOwner,
} from "@/projects/state";
import { ProjectFileRecord } from "@/projects/type";

/**
 * Builds a minimal project record for lifecycle ownership tests.
 *
 * @param id - Stable project id and path segment
 * @returns Project record with deterministic fields
 */
function createProjectRecord(id: string): ProjectFileRecord {
  const project: ProjectConfig = {
    id,
    name: id,
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
  };
  return {
    project,
    filePath: `Projects/${id}/project.md`,
    folderName: id,
  };
}

describe("Projects state lifecycle ownership", () => {
  it("prevents a late old owner and lease from changing a newer same-path lifecycle", () => {
    const sharedPath = "Projects/Shared/project.md";
    const ownerA = beginProjectStateLifecycle();
    const recordA = createProjectRecord("A");

    expect(updateCachedProjectRecordsForOwner(ownerA, [recordA])).toBe(true);
    const leaseA = acquireProjectFileWrite(ownerA, sharedPath);
    expect(leaseA).toBeDefined();
    expect(isPendingFileWrite(sharedPath)).toBe(true);

    const ownerB = beginProjectStateLifecycle();
    expect(isProjectStateOwnerActive(ownerA)).toBe(false);
    expect(isProjectStateOwnerActive(ownerB)).toBe(true);
    expect(getCachedProjectRecords()).toEqual([]);
    expect(isPendingFileWrite(sharedPath)).toBe(false);

    const recordB = createProjectRecord("B");
    expect(updateCachedProjectRecordsForOwner(ownerB, [recordB])).toBe(true);
    const leaseB = acquireProjectFileWrite(ownerB, sharedPath);
    expect(leaseB).toBeDefined();
    expect(isPendingFileWrite(sharedPath)).toBe(true);

    expect(updateCachedProjectRecordsForOwner(ownerA, [createProjectRecord("late-A")])).toBe(false);
    expect(releaseProjectFileWrite(leaseA!)).toBe(false);
    expect(releaseProjectStateLifecycle(ownerA)).toBe(false);

    expect(getCachedProjectRecords()).toEqual([recordB]);
    expect(isPendingFileWrite(sharedPath)).toBe(true);
    expect(isProjectStateOwnerActive(ownerB)).toBe(true);

    expect(releaseProjectFileWrite(leaseB!)).toBe(true);
    expect(releaseProjectFileWrite(leaseB!)).toBe(false);
    expect(isPendingFileWrite(sharedPath)).toBe(false);
    expect(releaseProjectStateLifecycle(ownerB)).toBe(true);
  });

  it("makes every stale owner cache mutator a deterministic no-op", () => {
    const staleOwner = beginProjectStateLifecycle();
    const owner = beginProjectStateLifecycle();
    const current = createProjectRecord("current");
    expect(updateCachedProjectRecordsForOwner(owner, [current])).toBe(true);

    const staleOperations = [
      () =>
        replaceCachedProjectRecordByFilePathForOwner(
          staleOwner,
          current.filePath,
          createProjectRecord("replacement")
        ),
      () => upsertCachedProjectRecordForOwner(staleOwner, createProjectRecord("upsert")),
      () => deleteCachedProjectRecordByIdForOwner(staleOwner, current.project.id),
      () => deleteCachedProjectRecordByFilePathForOwner(staleOwner, current.filePath),
    ];

    for (const staleOperation of staleOperations) {
      expect(staleOperation()).toBe(false);
      expect(getCachedProjectRecords()).toEqual([current]);
    }

    expect(releaseProjectStateLifecycle(owner)).toBe(true);
  });

  it("disables unowned compatibility writes after ownership is activated", () => {
    const owner = beginProjectStateLifecycle();
    const current = createProjectRecord("current");
    expect(updateCachedProjectRecordsForOwner(owner, [current])).toBe(true);

    updateCachedProjectRecords([createProjectRecord("legacy-late")]);
    replaceCachedProjectRecordByFilePath(
      current.filePath,
      createProjectRecord("legacy-replacement")
    );
    upsertCachedProjectRecord(createProjectRecord("legacy-upsert"));
    deleteCachedProjectRecordById(current.project.id);
    deleteCachedProjectRecordByFilePath(current.filePath);
    addPendingFileWrite(current.filePath);
    removePendingFileWrite(current.filePath);

    expect(getCachedProjectRecords()).toEqual([current]);
    expect(isPendingFileWrite(current.filePath)).toBe(false);
    expect(releaseProjectStateLifecycle(owner)).toBe(true);
  });

  it("keeps normalized same-path writes pending until every exact lease is released", () => {
    const owner = beginProjectStateLifecycle();
    const canonicalPath = "Projects/Shared/project.md";
    const first = acquireProjectFileWrite(owner, "Projects//Shared/project.md");
    const second = acquireProjectFileWrite(owner, canonicalPath);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(isPendingFileWrite(canonicalPath)).toBe(true);

    expect(releaseProjectFileWrite(first!)).toBe(true);
    expect(isPendingFileWrite(canonicalPath)).toBe(true);
    expect(releaseProjectFileWrite(second!)).toBe(true);
    expect(isPendingFileWrite(canonicalPath)).toBe(false);
    expect(releaseProjectStateLifecycle(owner)).toBe(true);
  });
});
