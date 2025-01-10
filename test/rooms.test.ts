import assert from "assert";
import { RoomManager } from "../src/RoomManager";
import { defaultConfig } from "../src/machine.config";
import { ServerSpecs } from "../src/schemas";
import { createMockPool } from "./pools";

describe("RoomManager tests", () => {
  //
  let roomManager: RoomManager;

  let mockSpecs: Record<string, ServerSpecs> = {};

  beforeEach(() => {
    //
    let pool = createMockPool();

    roomManager = new RoomManager({ pool });

    roomManager._getServerSpecs = async (roomId: string) => {
      return mockSpecs[roomId] || defaultConfig;
    };
  });

  afterEach(async () => {
    //
    await roomManager.pool.reset();
  });

  it("should create a machine for a room", async () => {
    //

    await roomManager.pool.scale();

    let roomId = "room1";

    let mid = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
      ip: "12.12.12.12",
    });

    const machine = await roomManager.pool.api.getMachine(mid);

    assert.equal(machine?.state, "started", "Machine should be started");

    assert.equal(
      machine.config.metadata.roomId,
      roomId,
      "Machine should have roomId metadata"
    );
  });

  it("should reuse a machine for a room", async () => {
    //
    let roomId = "room1";

    let mid1 = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
    });
    let mid2 = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
    });

    const machine1 = await roomManager.pool.api.getMachine(mid1);

    assert.equal(machine1?.state, "started", "Machine1 should be started");
    assert.equal(
      machine1?.config.metadata.roomId,
      roomId,
      "Machine should be for room1"
    );

    assert.equal(mid1, mid2, "Machine should be reused");
  });

  it("should not reuse a machine for a different room", async () => {
    //
    let roomId1 = "room1";
    let roomId2 = "room2";

    let mid1 = await roomManager.getOrCreateMachineForRoom({
      roomId: roomId1,
      region: "mad",
    });
    let mid2 = await roomManager.getOrCreateMachineForRoom({
      roomId: roomId2,
      region: "mad",
    });

    const machine1 = await roomManager.pool.api.getMachine(mid1);
    const machine2 = await roomManager.pool.api.getMachine(mid2);

    assert.equal(machine1?.state, "started", "Machine1 should be started");
    assert.equal(machine2?.state, "started", "Machine2 should be started");

    assert.equal(
      machine1?.config.metadata.roomId,
      roomId1,
      "Machine1 should be for room1"
    );
    assert.equal(
      machine2?.config.metadata.roomId,
      roomId2,
      "Machine2 should be for room2"
    );

    assert.notEqual(mid1, mid2, "Machine should not be reused");
  });

  it("should be able to handle concurrent requests", async () => {
    //
    let roomId1 = "room1";

    let req1 = roomManager.getOrCreateMachineForRoom({
      roomId: roomId1,
      region: "mad",
    });
    let req2 = roomManager.getOrCreateMachineForRoom({
      roomId: roomId1,
      region: "mad",
    });

    let [mid1, mid2] = await Promise.all([req1, req2]);

    assert.equal(mid1, mid2, "Machine should be reused");

    const machine = await roomManager.pool.api.getMachine(mid1);

    assert.equal(machine?.state, "started", "Machine1 should be started");
    assert.equal(
      machine?.config.metadata.roomId,
      roomId1,
      "Machine should be for room1"
    );

    let req3 = roomManager.getOrCreateMachineForRoom({
      roomId: roomId1,
      region: "mad",
    });

    let mid3 = await req3;

    assert.equal(mid1, mid3, "Machine should be reused");
  });

  it("should create a machine conform to room specs", async () => {
    //
    let roomId = "room-" + Math.random().toString(36).substr(2, 5);

    let specs: ServerSpecs = {
      guest: {
        cpu_kind: "performance",
        cpus: 2,
        memory_mb: 2048,
      },
      idleTimeout: 600,
    };

    mockSpecs[roomId] = specs;

    await roomManager.pool.scale();

    let mid = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
      specs: true,
    });

    const machine = await roomManager.pool.api.getMachine(mid);

    assert.equal(machine?.state, "started", "Machine should be started");
    assert.equal(machine.config.guest.cpu_kind, specs.guest.cpu_kind);
    assert.equal(machine.config.guest.cpus, specs.guest.cpus);
    assert.equal(machine.config.guest.memory_mb, specs.guest.memory_mb);
    assert.equal(machine.config.metadata.roomId, roomId);
    assert.equal(machine.config.env.ROOM_IDLE_TIMEOUT_SEC, specs.idleTimeout);
  });

  it("should reuse an existing machine even if room specs are provided", async () => {
    //
    let roomId = "room-" + Math.random().toString(36).substr(2, 5);

    let specs: ServerSpecs = {
      guest: {
        cpu_kind: "performance",
        cpus: 2,
        memory_mb: 2048,
      },
      idleTimeout: 600,
    };

    mockSpecs[roomId] = specs;

    await roomManager.pool.scale();

    let mid1 = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
      specs: true,
    });

    // change the specs in meantime
    mockSpecs[roomId] = {
      guest: {
        cpu_kind: "shared",
        cpus: 1,
        memory_mb: 1024,
      },
      idleTimeout: 300,
    };

    let mid2 = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
      specs: true,
    });

    assert.equal(mid1, mid2, "Machine should be reused");

    const machine = await roomManager.pool.api.getMachine(mid1);
    assert.equal(machine?.state, "started", "Machine should be started");
    assert.equal(machine.config.guest.cpu_kind, specs.guest.cpu_kind);
  });
});
