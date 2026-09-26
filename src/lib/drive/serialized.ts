/**
 * Wraps an async job so only one run is ever in flight. A call made while a
 * run is in flight doesn't start a second one alongside it: it queues one
 * more run for after the current one finishes, and any further calls in the
 * meantime share that queued run. Each call's promise settles when a run that
 * started after the call has finished.
 *
 * Drive sync uses this so a second debounced sync can't read the file's
 * metadata mid-upload and take this tab's own write for someone else's.
 */
export function serialized(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  function call(): Promise<void> {
    if (!current) {
      current = run().finally(() => {
        current = null;
      });
      return current;
    }
    if (!queued) {
      queued = current
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return call();
        });
    }
    return queued;
  }

  return call;
}
