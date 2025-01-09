import assert from "assert";
import { FlyMockApi } from "./FlyMockApi";
import { MachinesPool } from "../src/MachinesPool";
import { Machine } from "../src/types";
import { defaultConfig } from "../src/machine.config";

let srcAppApi: FlyMockApi;
let api: FlyMockApi;

const MIN_POOL_SIZE = 10;
const MAX_POOL_SIZE = 20;
const POLL_INTERVAL = 100;

let pool: MachinesPool;

console.log("NODE_ENV", process.env.NODE_ENV);

describe("MachinesPool tests", () => {
  //

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
    assert.equal(
      m.config.metadata?.ref,
      "mref",
      "Machine should be cloned from pool's ref"
    );
  };

  before(async () => {
    //
    FlyMockApi.resetAll();
    srcAppApi = FlyMockApi.create("srcApp");
    api = FlyMockApi.create("default");

    srcAppApi._machinesDb.push(
      srcAppApi._mockCreateMachine({
        id: "mref",
        config: {
          ...defaultConfig,
          metadata: { ref: "mref" },
        },
        region: "lhr",
      })
    );
  });

  beforeEach(async () => {
    //
    pool = new MachinesPool({
      poolId: "pool1",
      minSize: MIN_POOL_SIZE,
      maxSize: MAX_POOL_SIZE,
      pollInterval: POLL_INTERVAL,
      api,
      templateApp: srcAppApi._app,
      templateMachineId: "mref",
    });
  });

  afterEach(async () => {
    //
    await pool.reset({ force: true });
  });

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

    const machine = await api.getMachine(mid);
    assertNonPooled(machine);

    // await api.waitMachine(machine.id, { state: "stopped" });
  });

  it("should get non pooled machines if pool if a config is speciefied", async () => {
    //
    await pool.scale();

    // fill the pool
    await claimPoolMachines(pool._minSize);

    const config = {
      guest: { cpu_kind: "performance", cpus: 4, memory_mb: 2048 },
      env: { timeout: Date.now() + 1000, tag: "t1" },
      metadata: { ref: "mref" },
    };

    // get a machine
    let mid = await pool.getMachine({
      config,
    });

    let machine = await api.getMachine(mid);
    assertNonPooled(machine);

    assert.equal(machine.config.guest.cpu_kind, "performance");
    assert.equal(machine.config.guest.cpus, 4);
    assert.equal(machine.config.guest.memory_mb, 2048);
    assert.equal(machine.config.metadata.ref, "mref");
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
    //  const machineIds = await claimPoolMachines(5, true);
    // assertDifferent(machineIds);
    // await assertPoolSize({ free: pool._minSize - 5, total: pool._minSize });

    // await pool.scale();
    // await assertPoolSize({ free: pool._minSize, total: pool._minSize + 5 });
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
    await Promise.all(claimedMachines.map((m) => pool.relaseMachine(m)));
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

    let mid = await pool.getMachine({ region: "mad" });

    let machine = await api.getMachine(mid);
    assert.equal(machine.state, "stopped");
    assert.ok(pool.isPooled(machine), "Machine should be pooled and free");
  });

  it("should get non pooled machines if pool is full", async () => {
    //
    await pool.scale();

    // fill the pool
    await claimPoolMachines(pool._minSize);

    // get a machine
    let mid = await pool.getMachine({ region: "mad" });

    let machine = await api.getMachine(mid);
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

    let machines = await Promise.all(mids.map((mid) => api.getMachine(mid)));

    // shoould have 4 machines
    assert.equal(machines.length, 4);

    // all should be pooled
    assert.ok(machines.every((m) => pool.isPooled(m)));

    // all should be stopped
    assert.ok(machines.every((m) => m.state === "stopped"));

    // all should be different
    assert.ok(new Set(machines.map((m) => m.id)).size === 4);
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

    let machines = await Promise.all(mids.map((mid) => api.getMachine(mid)));

    // shoould have right size machines
    assert.equal(machines.length, SIZE);

    // all should be stopped
    machines.forEach((m) => assert.equal(m.state, "stopped"));

    // all should be different
    assert.ok(new Set(machines.map((m) => m.id)).size === SIZE);

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
    api.setMaxFailureCount(5);

    try {
      let mid = await pool.getMachine({ region: "mad" });
      assert.fail("Should not get a machine");
    } catch (e) {
      assert.equal(e.message, "Failed to create machine");
    }

    api.resetFailureCount();
    api.setMaxFailureCount(2);

    let mid = await pool.getMachine({ region: "mad" });
    let machine = await api.getMachine(mid);

    assertNonPooled(machine);
    assert.equal(machine.state, "stopped");
  });
});
