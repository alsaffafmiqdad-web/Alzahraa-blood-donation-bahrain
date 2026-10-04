import { describe, expect, it, vi } from "vitest";
import { createLatestPick } from "@/lib/latest-pick";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const file = (name: string) => new File([new Uint8Array([1])], name);

function handlers(work: (f: File) => Promise<string>) {
  return { start: vi.fn(), work: vi.fn(work), done: vi.fn() };
}

describe("createLatestPick", () => {
  it("runs start synchronously, then applies the result", async () => {
    const picker = createLatestPick();
    const h = handlers(async (f) => f.name);
    const pending = picker.pick(file("a"), h);
    expect(h.start).toHaveBeenCalledTimes(1);
    await pending;
    expect(h.done).toHaveBeenCalledWith("a");
  });

  it("ignores an empty pick entirely", async () => {
    const picker = createLatestPick();
    const h = handlers(async () => "x");
    await picker.pick(undefined, h);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.work).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
  });

  it("F1: a cancelled chooser (empty pick) mid-processing does not strand the photo still processing", async () => {
    const picker = createLatestPick();
    const a = deferred<string>();
    const hA = handlers(() => a.promise);
    const pendingA = picker.pick(file("a"), hA);

    await picker.pick(undefined, handlers(async () => "never"));
    a.resolve("a");
    await pendingA;

    // done clears busy in the component; it must still run for A.
    expect(hA.done).toHaveBeenCalledWith("a");
  });

  it("a newer pick supersedes an older one, even if the older finishes last", async () => {
    const picker = createLatestPick();
    const a = deferred<string>();
    const b = deferred<string>();
    const hA = handlers(() => a.promise);
    const hB = handlers(() => b.promise);
    const pendingA = picker.pick(file("a"), hA);
    const pendingB = picker.pick(file("b"), hB);

    b.resolve("b");
    await pendingB;
    a.resolve("a");
    await pendingA;

    expect(hB.done).toHaveBeenCalledWith("b");
    expect(hA.done).not.toHaveBeenCalled();
  });

  it("an older pick finishing first is still dropped once a newer pick started", async () => {
    const picker = createLatestPick();
    const a = deferred<string>();
    const b = deferred<string>();
    const hA = handlers(() => a.promise);
    const hB = handlers(() => b.promise);
    const pendingA = picker.pick(file("a"), hA);
    const pendingB = picker.pick(file("b"), hB);

    a.resolve("a");
    await pendingA;
    expect(hA.done).not.toHaveBeenCalled();
    b.resolve("b");
    await pendingB;
    expect(hB.done).toHaveBeenCalledWith("b");
  });

  it("cancel drops the in-flight result", async () => {
    const picker = createLatestPick();
    const a = deferred<string>();
    const hA = handlers(() => a.promise);
    const pendingA = picker.pick(file("a"), hA);
    picker.cancel();
    a.resolve("a");
    await pendingA;
    expect(hA.done).not.toHaveBeenCalled();
  });

  it("works again after a cancel", async () => {
    const picker = createLatestPick();
    picker.cancel();
    const h = handlers(async (f) => f.name);
    await picker.pick(file("c"), h);
    expect(h.done).toHaveBeenCalledWith("c");
  });
});
