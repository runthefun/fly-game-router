import assert from "assert";
import { ResourceLock } from "../src/lock";
import { createDeferred, delay } from "./utils";

describe("MachinesPool tests", () => {
  let lock: ResourceLock<string>;

  beforeEach(() => {
    //
    lock = new ResourceLock();
  });

  it("should acquire and release lock", () => {
    //
    assert.ok(lock.acquire("1", 1000));
    assert.ok(lock.isLocked("1"));

    assert.ok(lock.release("1"));
    assert.ok(!lock.isLocked("1"));
  });

  it("should not acquire lock if already locked", () => {
    //
    assert.ok(lock.acquire("1", 1000));
    assert.ok(!lock.acquire("1", 1000));
  });

  it("should release lock after ttl", async () => {
    //
    assert.ok(lock.acquire("1", 100));

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.ok(!lock.isLocked("1"));
  });

  it("should release lock after ttl with tryWithLock", async () => {
    //
    const deferred = createDeferred();

    const rms = Math.floor(Math.random() * 100) + 1;

    const res = lock.tryWithLock("1", () => delay(rms), 100);

    assert.ok(lock.isLocked("1"));

    await delay(rms + 120);

    assert.ok(!lock.isLocked("1"));
  });
});
