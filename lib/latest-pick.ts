/* Isomorphic and framework-free, so the pick bookkeeping is testable without a DOM. */

export type PickHandlers<R> = {
  /** Runs synchronously when a real file is picked. */
  start: () => void;
  /** Must not reject. */
  work: (file: File) => Promise<R>;
  /** Called only if no newer pick or cancel happened while `work` ran. */
  done: (result: R) => void;
};

/** Applies only the latest file pick's result, so a slow earlier photo can't land after a newer one. */
export function createLatestPick() {
  let current = 0;
  return {
    async pick<R>(file: File | undefined, h: PickHandlers<R>): Promise<void> {
      // An empty change (some browsers fire one when the chooser is cancelled) must not
      // supersede a photo that is still processing, or nothing would ever clear its busy state.
      if (!file) return;
      const run = ++current;
      h.start();
      const result = await h.work(file);
      if (run === current) h.done(result);
    },
    cancel() {
      current++;
    },
  };
}
