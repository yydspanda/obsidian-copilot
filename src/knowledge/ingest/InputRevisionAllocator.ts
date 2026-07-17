/** Source observation event that requires a durable monotonic revision. */
export interface AllocateSourceInputRevisionRequest {
  bundleId: string;
  sourceId: string;
}

/** Result of allocating one durable source observation revision. */
export interface SourceInputRevisionAllocation {
  inputRevision: number;
}

/** Durable allocator used before an exact source input enters the ingest queue. */
export interface SourceInputRevisionAllocator {
  /**
   * Allocates a strictly newer revision for every captured source observation.
   * The source adapter must call this at the start of its event handler, before
   * any asynchronous read or parse, and attach the result to the bytes it then
   * observes. If an older read completes later, Queue's source high-watermark
   * rejects its lower revision.
   *
   * Equal content still receives a newer observation revision; Queue may
   * deduplicate compilation while preserving ordering.
   *
   * @param request - Bundle and source identity captured by the watcher
   * @returns Stable allocation safe to pass to IngestQueue.enqueue
   */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation>;
}
