import assert from "assert";
import { RoomManager } from "../src/RoomManager";
import { defaultConfig } from "../src/machine.config";
import { ServerSpecs } from "../src/schemas";
import { createMockPool } from "./pools";
import { delay, randomId } from "./utils";

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

  const assertRoomMachine = async (roomId: string, mid: string) => {
    //
    const machine = await roomManager.pool.api.getMachine(mid);

    assert.ok(machine, "Machine should exist");
    assert.equal(
      roomManager.pool.getMachineTag(machine),
      roomId,
      "Machine should be for room " + roomId
    );
    assert.equal(machine?.state, "started", "Machine should be started");
  };

  it("should create a machine for a room", async () => {
    //

    await roomManager.pool.scale();

    let roomId = "room1";

    let mid = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
      ip: "12.12.12.12",
    });

    await assertRoomMachine(roomId, mid);
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

    await assertRoomMachine(roomId, mid1);

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

    await assertRoomMachine(roomId1, mid1);
    await assertRoomMachine(roomId2, mid2);

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

    await assertRoomMachine(roomId1, mid1);

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

    await assertRoomMachine(roomId, mid);

    const machine = await roomManager.pool.api.getMachine(mid);

    assert.equal(machine?.state, "started", "Machine should be started");
    assert.equal(machine.config.guest.cpu_kind, specs.guest.cpu_kind);
    assert.equal(machine.config.guest.cpus, specs.guest.cpus);
    assert.equal(machine.config.guest.memory_mb, specs.guest.memory_mb);
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

    await assertRoomMachine(roomId, mid1);

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

    assert.equal(machine.config.guest.cpu_kind, specs.guest.cpu_kind);
  });

  it("should handle concurrent join/release", async () => {
    // 1- join a room
    // 2- simultaneously release the machine and send andother join request
    // 3- we should never get the 2nd join to reuse the released machine

    const roomId = "room1-test";

    let mid1 = await roomManager.getOrCreateMachineForRoom({
      roomId,
      region: "mad",
    });

    await assertRoomMachine(roomId, mid1);

    let [res, mid2] = await Promise.all([
      roomManager.deleteRoom(roomId),
      roomManager.getOrCreateMachineForRoom({
        roomId,
        region: "mad",
      }),
    ]);

    // either machine was reused or a new one was created
    // if resus
    if (mid1 === mid2) {
      //
      console.log("reused machine", mid1);
      const m = await roomManager.pool.api.getMachine(mid1);
      assert.equal(roomManager.pool.getMachineTag(m), roomId);
      assert.equal(m.state, "started");
    } else {
      //
      console.log("new machine", mid2);
      await assertRoomMachine(roomId, mid2);

      const m = await roomManager.pool.api.getMachine(mid1);
      // should be free
      assert.ok(roomManager.pool.isFree(m));
    }
  });
});
