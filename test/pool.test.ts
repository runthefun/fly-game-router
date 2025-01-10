import "dotenv/config";
import assert from "assert";
import { FlyMockApi } from "./FlyMockApi";
import { MachinesPool } from "../src/MachinesPool";
import { Machine } from "../src/types";
import { createMockPool } from "./pools";
import { randomId } from "./utils";

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

  const assertClaimed = (machine: Machine, tag?: string) => {
    //
    assertIsCloned(machine);
    assert.ok(pool.isPooled(machine), "Machine should be pooled");
    assert.equal(machine.state, "stopped");

    if (tag) {
      assert.equal(pool.getMachineTag(machine), tag);
    }
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
        .map((_, i) => pool.getMachine({ tag: randomId() }))
    );
    pool._machinesLock._log = false;

    return ms;
  };

  it("should create a machine on the fly if not active", async () => {
    //
    const tag = randomId();
    let mid = await pool.getMachine({ tag });

    const machine = await pool.api.getMachine(mid);
    assertClaimed(machine, tag);

    // await pool.api.waitMachine(machine.id, { state: "stopped" });
  });

  it("should get machine for a spec config", async () => {
    //
    await pool.scale();

    // fill the pool
    // await claimPoolMachines(pool._minSize);
    const tag = randomId();

    const config = {
      guest: { cpu_kind: "shared", cpus: 4, memory_mb: 1024 },
      env: { tag },
      metadata: { ref: pool._templateMachineId },
    };

    // get a machine
    let mid = await pool.getMachine({
      config,
      tag,
    });

    let machine = await pool.api.getMachine(mid);
    assertClaimed(machine, tag);

    assert.equal(machine.config.guest.cpu_kind, config.guest.cpu_kind);
    assert.equal(machine.config.guest.cpus, config.guest.cpus);
    assert.equal(machine.config.guest.memory_mb, config.guest.memory_mb);
    assert.equal(machine.config.metadata.ref, pool._templateMachineId);
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

    const tag = randomId();
    let mid = await pool.getMachine({ tag });

    let machine = await pool.api.getMachine(mid);
    assertClaimed(machine, tag);
  });

  it("should create pooled machines if pool is full", async () => {
    //
    await pool.scale();
    await assertAllStopped();

    // fill the pool
    await claimPoolMachines(pool._minSize);

    // get a machine
    const tag = randomId();
    let mid = await pool.getMachine({ tag });

    let machine = await pool.api.getMachine(mid);
    assertClaimed(machine, tag);
  });

  it("should handle concurrent getMachine calls", async () => {
    //
    await pool.scale();

    const tags = Array(4)
      .fill(0)
      .map((_, i) => randomId());

    let mids = await Promise.all(tags.map((tag) => pool.getMachine({ tag })));

    let machines = await Promise.all(
      mids.map((mid) => pool.api.getMachine(mid))
    );

    // shoould have 4 machines
    assert.equal(machines.length, 4);
    assertDifferent(mids);

    machines.forEach((m, i) => {
      assertClaimed(m, tags[i]);
    });
  });

  it("should handle concurrent getMachine calls with overflow", async () => {
    //
    const OVERFLOW = 2;
    const SIZE = pool._minSize + OVERFLOW; // 7

    const tags = Array(SIZE)
      .fill(0)
      .map((_, i) => randomId());

    await pool.scale();

    // get concurrent machines
    let mids = await Promise.all(tags.map((tag) => pool.getMachine({ tag })));

    let machines = await Promise.all(
      mids.map((mid) => pool.api.getMachine(mid))
    );

    // shoould have right size machines
    assert.equal(machines.length, SIZE);
    // all should be different
    assertDifferent(mids);

    // all should be stopped
    machines.forEach((m) => {
      assertClaimed(m);
    });

    await pool.scale();

    await assertPoolSize({
      free: pool._minSize,
      total: pool._minSize + SIZE,
    });
  });

  it("should retry if machine creation fails", async () => {
    //
    if (!(pool.api instanceof FlyMockApi)) {
      return;
    }

    pool.api.setMaxFailureCount(5);

    const tag = randomId();
    try {
      let mid = await pool.getMachine({ tag });
      assert.fail("Should not get a machine");
    } catch (e) {
      assert.equal(e.message, "Failed to create machine");
    }

    pool.api.resetFailureCount();
    pool.api.setMaxFailureCount(2);

    let mid = await pool.getMachine({ tag });
    let machine = await pool.api.getMachine(mid);

    assertClaimed(machine, tag);
  });
});
