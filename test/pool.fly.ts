import "dotenv/config";
import assert from "assert";
import { MachinesPool } from "../src/MachinesPool";
import { Machine } from "../src/types";
import { createFlyPool, createMockPool } from "./pools";

let pool: MachinesPool;

describe("Pool Fly tests", () => {
  //
  before(async () => {
    //
    pool = createFlyPool();
  });

  after(async () => {
    //
    await pool.api.destroyAll();
  });

  const assertPoolSize = async (sizes: { free: number; total: number }) => {
    //
    let poolSize = await pool.getPoolSize();

    assert.equal(
      poolSize.free,
      sizes.free,
      "Pool free size should be " + sizes.free
    );
    assert.equal(
      poolSize.total,
      sizes.total,
      "Pool total size should be " + sizes.total
    );
  };

  const assertIsCloned = (m: Machine) => {
    //
    assert.equal(m.config.metadata?.ref, pool._templateMachineId);
  };

  const assertDifferent = (machineIds: string[]) => {
    //
    const ids = new Set(machineIds.map((mid) => mid));
    assert.equal(
      ids.size,
      machineIds.length,
      "All machine ids should be different, got " + machineIds.join(",")
    );
  };

  const assertAllStopped = async () => {
    //
    const machines = await pool.getMachines();
    machines.forEach((m) => {
      assertIsCloned(m);
      assert.ok(m.state === "stopped");
    });
  };

  const assertNonPooled = (machine: Machine) => {
    //
    assertIsCloned(machine);
    assert.ok(!pool.isPooled(machine), "Machine should not be pooled");
    assert.equal(machine.state, "stopped");
  };

  const claimPoolMachines = async (n: number, log = false) => {
    //
    const machines = await pool.getFreeMachines();
    if (machines.length < n) {
      throw new Error(
        "Not enough free machines to start " + n + " > " + machines.length
      );
    }

    pool._machinesLock._log = log;
    const ms = Promise.all(
      Array(n)
        .fill(0)
        .map((_, i) => pool.getMachine({ tag: "m" + i }))
    );
    pool._machinesLock._log = false;

    return ms;
  };

  it("should scale up/down", async () => {
    //
    await pool.scale();

    await assertAllStopped();

    // check if we have the min pool size
    await assertPoolSize({ free: pool._minSize, total: pool._minSize });

    // start 5 machines
    const claimed = pool._minSize - 2;
    const machineIds = await claimPoolMachines(claimed);
    assertDifferent(machineIds);
    await assertPoolSize({
      free: pool._minSize - claimed,
      total: pool._minSize,
    });

    await pool.scale();
    await assertPoolSize({
      free: pool._minSize,
      total: pool._minSize + claimed,
    });

    // release all claimed machines
    await Promise.all(machineIds.map((mid) => pool.releaseMachine(mid)));

    await assertPoolSize({
      free: pool._minSize + claimed,
      total: pool._minSize + claimed,
    });

    // scale down
    await pool.scale();

    await assertPoolSize({ free: pool._minSize, total: pool._minSize });
  });

  it("should scale up/down with overflow", async () => {
    //
    const OVERFLOW = 2;
    const SIZE = pool._minSize + OVERFLOW;

    await pool.scale();

    // get concurrent machines
    let mids = await Promise.all(
      Array(SIZE)
        .fill(0)
        .map((_, i) => pool.getMachine({ tag: "m" + i }))
    );

    let machines = await Promise.all(
      mids.map((mid) => pool.api.getMachine(mid))
    );

    // shoould have right size machines
    assert.equal(machines.length, SIZE);

    // all should be stopped
    machines.forEach((m) => assert.equal(m.state, "stopped"));

    // all should be different
    assertDifferent(mids);

    // pool._minSize machines should be pooled
    assert.equal(
      machines.filter((m) => pool.isPooled(m)).length,
      pool._minSize
    );

    // all others should be non pooled
    assert.equal(machines.filter((m) => !pool.isPooled(m)).length, OVERFLOW);

    await pool.scale();

    await assertPoolSize({
      free: pool._minSize,
      total: pool._minSize + SIZE - OVERFLOW,
    });
  });
});
