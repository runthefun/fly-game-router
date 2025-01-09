import "dotenv/config";
import assert from "assert";
import { FlyMockApi } from "./FlyMockApi";
import { MachinesPool } from "../src/MachinesPool";
import { Machine } from "../src/types";
import { createMockPool } from "./pools";

let pool: MachinesPool;

describe("MachinesPool tests", () => {
  //
  before(async () => {
    //
  });

  beforeEach(async () => {
    //
    pool = createMockPool();
  });

  afterEach(async () => {
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

  it("should create a non pooled machine if not active", async () => {
    //
    let mid = await pool.getMachine({ region: "mad" });

    const machine = await pool.api.getMachine(mid);
    assertNonPooled(machine);

    // await pool.api.waitMachine(machine.id, { state: "stopped" });
  });

  it("should get non pooled machines if pool if a config is speciefied", async () => {
    //
    await pool.scale();

    // fill the pool
    await claimPoolMachines(pool._minSize);

    const config = {
      guest: { cpu_kind: "shared", cpus: 4, memory_mb: 1024 },
      env: { timeout: "" + Date.now() + 1000, tag: "t1" },
      metadata: { ref: pool._templateMachineId },
    };

    // get a machine
    let mid = await pool.getMachine({
      config,
    });

    let machine = await pool.api.getMachine(mid);
    assertNonPooled(machine);

    assert.equal(machine.config.guest.cpu_kind, config.guest.cpu_kind);
    assert.equal(machine.config.guest.cpus, config.guest.cpus);
    assert.equal(machine.config.guest.memory_mb, config.guest.memory_mb);
    assert.equal(machine.config.metadata.ref, pool._templateMachineId);
    assert.equal(machine.config.env.timeout, config.env.timeout);
    assert.equal(machine.config.env.tag, config.env.tag);
  });

  //

  it("should scale up", async () => {
    //
    await pool.scale();

    await assertAllStopped();

    // check if we have the min pool size
    await assertPoolSize({ free: pool._minSize, total: pool._minSize });

    // start 5 machines
    const machineIds = await claimPoolMachines(5);
    assertDifferent(machineIds);
    await assertPoolSize({ free: pool._minSize - 5, total: pool._minSize });

    await pool.scale();
    await assertPoolSize({ free: pool._minSize, total: pool._minSize + 5 });
  });

  it("should scale down", async () => {
    //
    await pool.scale();

    await assertAllStopped();

    const claimedMachines = await claimPoolMachines(5);

    await assertPoolSize({ free: pool._minSize - 5, total: pool._minSize });

    // should scale up
    await pool.scale();
    await assertPoolSize({ free: pool._minSize, total: pool._minSize + 5 });

    // stop started machines
    await Promise.all(claimedMachines.map((m) => pool.releaseMachine(m)));
    await assertPoolSize({ free: pool._minSize + 5, total: pool._minSize + 5 });

    await assertAllStopped();

    // should scale down
    await pool.scale();
    await assertPoolSize({ free: pool._minSize, total: pool._minSize });

    await assertAllStopped();
  });

  it("should get machines from the pool", async () => {
    //
    await pool.scale();
    await assertAllStopped();

    let mid = await pool.getMachine({ region: "mad" });

    let machine = await pool.api.getMachine(mid);
    assert.equal(machine.state, "stopped");
    assert.ok(pool.isPooled(machine), "Machine should be pooled and free");
  });

  it("should get non pooled machines if pool is full", async () => {
    //
    await pool.scale();
    await assertAllStopped();

    // fill the pool
    await claimPoolMachines(pool._minSize);

    // get a machine
    let mid = await pool.getMachine({ region: "mad" });

    let machine = await pool.api.getMachine(mid);
    assertNonPooled(machine);
  });

  it("should handle concurrent getMachine calls", async () => {
    //
    await pool.scale();

    let mids = await Promise.all([
      pool.getMachine({ region: "mad" }),
      pool.getMachine({ region: "mad" }),
      pool.getMachine({ region: "mad" }),
      pool.getMachine({ region: "mad" }),
    ]);

    let machines = await Promise.all(
      mids.map((mid) => pool.api.getMachine(mid))
    );

    // shoould have 4 machines
    assert.equal(machines.length, 4);

    // all should be pooled
    assert.ok(machines.every((m) => pool.isPooled(m)));

    // all should be stopped
    assert.ok(machines.every((m) => m.state === "stopped"));

    // all should be different
    assertDifferent(mids);
  });

  it("should handle concurrent getMachine calls with overflow", async () => {
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

  it("should retry if machine creation fails", async () => {
    //
    if (!(pool.api instanceof FlyMockApi)) {
      return;
    }

    pool.api.setMaxFailureCount(5);

    try {
      let mid = await pool.getMachine({ region: "mad" });
      assert.fail("Should not get a machine");
    } catch (e) {
      assert.equal(e.message, "Failed to create machine");
    }

    pool.api.resetFailureCount();
    pool.api.setMaxFailureCount(2);

    let mid = await pool.getMachine({ region: "mad" });
    let machine = await pool.api.getMachine(mid);

    assertNonPooled(machine);
    assert.equal(machine.state, "stopped");
  });
});
