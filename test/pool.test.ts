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
      })
    );
  });

  beforeEach(async () => {
    //
    pool = new MachinesPool({
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
    await pool.reset();
  });

  const assertAllStopped = async () => {
    //
    const machines = await pool.getMachines();
    machines.all.forEach((m) => {
      assertIsCloned(m);
      assert.ok(m.state === "stopped" || m.state === "stopping");
    });
  };

  const assertNonPooled = (machine: Machine) => {
    //
    assertIsCloned(machine);
    assert.ok(!pool.isPooled(machine), "Machine should not be pooled");
    assert.equal(machine.state, "started");
  };

  const startMachines = async (n: number) => {
    //
    const machines = await pool.getFreeMachines();
    if (machines.length < n) {
      throw new Error(
        "Not enough free machines to start " + n + " > " + machines.length
      );
    }
    const toStart = machines.slice(0, n);
    await Promise.all(toStart.map((m) => api.startMachine(m.id)));
    return toStart;
  };

  it("should create a non pooled machine if not active", async () => {
    //
    let mid = await pool.getMachine();

    const machine = await api.getMachine(mid);
    assertNonPooled(machine);

    await api.stopMachine(machine.id);
    // await api.waitMachine(machine.id, { state: "stopped" });
  });

  //

  it("should scale up", async () => {
    //
    await pool.scale();

    await assertAllStopped();

    // check if we have the min pool size
    await assertPoolSize({ free: pool._minSize, total: pool._minSize });

    // start 5 machines
    await startMachines(5);
    await assertPoolSize({ free: pool._minSize - 5, total: pool._minSize });

    await pool.scale();
    await assertPoolSize({ free: pool._minSize, total: pool._minSize + 5 });
  });

  it("should scale down", async () => {
    //
    await pool.scale();

    await assertAllStopped();

    const startedMachines = await startMachines(5);

    await assertPoolSize({ free: pool._minSize - 5, total: pool._minSize });

    // should scale up
    await pool.scale();
    await assertPoolSize({ free: pool._minSize, total: pool._minSize + 5 });

    // stop started machines
    await Promise.all(startedMachines.map((m) => api.stopMachine(m.id)));
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

    let mid = await pool.getMachine();

    let machine = await api.getMachine(mid);
    assert.equal(machine.state, "started");
    assert.ok(pool.isPooled(machine), "Machine should be pooled and free");
  });

  it("should get non pooled machines if pool is full", async () => {
    //
    await pool.scale();

    // fill the pool
    await startMachines(pool._minSize);

    // get a machine
    let mid = await pool.getMachine();

    let machine = await api.getMachine(mid);
    assertNonPooled(machine);

    await api.stopMachine(mid);
  });

  it("should handle concurrent getMachine calls", async () => {
    //
    await pool.scale();

    let mids = await Promise.all([
      pool.getMachine(),
      pool.getMachine(),
      pool.getMachine(),
      pool.getMachine(),
    ]);

    let machines = await Promise.all(mids.map((mid) => api.getMachine(mid)));

    // shoould have 4 machines
    assert.equal(machines.length, 4);

    // all should be pooled
    assert.ok(machines.every((m) => pool.isPooled(m)));

    // all should be started
    assert.ok(machines.every((m) => m.state === "started"));

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
        .map((_, i) => pool.getMachine("m" + i))
    );

    let machines = await Promise.all(mids.map((mid) => api.getMachine(mid)));

    // shoould have right size machines
    assert.equal(machines.length, SIZE);

    // all should be started
    machines.forEach((m) => assert.equal(m.state, "started"));

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
      let mid = await pool.getMachine();
      assert.fail("Should not get a machine");
    } catch (e) {
      assert.equal(e.message, "Failed to create machine");
    }

    api.resetFailureCount();
    api.setMaxFailureCount(2);

    let mid = await pool.getMachine();
    let machine = await api.getMachine(mid);

    assertNonPooled(machine);
    assert.equal(machine.state, "started");
  });
});
