import assert from "assert";
import { RoomManager } from "../src/RoomManager";
import { defaultConfig } from "../src/machine.config";
import { ServerSpecs } from "../src/schemas";
import { createMockPool } from "./pools";
import { delay, randomId } from "./utils";
import { MachinesGC } from "../src/MachineGC";

describe("MachineGC tests", () => {
  //
  let roomManager: RoomManager;
  let gc: MachinesGC;

  beforeEach(() => {
    //
    let pool = createMockPool();

    roomManager = new RoomManager({ pool });

    gc = new MachinesGC({
      pool,
      idleTimeout: 100,
      pollInterval: 100,
      onShouldRelease: (mid) => {},
    });

    gc.showLogs = false;

    roomManager._getServerSpecs = async (roomId: string) => {
      return null as any;
    };
  });

  afterEach(async () => {
    //
    await roomManager.pool.reset({ force: true });
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

  it("Should garbage collect machines", async () => {
    //
    let collected = {};

    gc.idleTimeout = 30 * 60 * 1000; // 30 minutes
    gc.pollInterval = 5 * 60 * 1000; // 1 minutes
    gc.onShouldRelease = (mid) => {
      collected[mid] = true;
    };

    let room1 = "room1";
    let room2 = "room2";

    let [mid1, mid2] = await Promise.all([
      roomManager.getOrCreateMachineForRoom({
        roomId: room1,
      }),
      roomManager.getOrCreateMachineForRoom({
        roomId: room2,
      }),
    ]);

    for (let i = 0; i <= 6; i++) {
      await gc.collect(gc.pollInterval);
    }

    assert.ok(Object.keys(collected).length === 0, "No machines collected yet");

    await roomManager.pool.api.stopMachine(mid1, true);
    roomManager.clearJoins(room1);

    for (let i = 0; i <= 6; i++) {
      if (i === 5) {
        // reset idle time
        await roomManager.getOrCreateMachineForRoom({ roomId: room1 });
      }
      await gc.collect(gc.pollInterval);
    }

    await roomManager.pool.api.stopMachine(mid1, true);
    roomManager.clearJoins(room1);

    assert.ok(Object.keys(collected).length === 0, "No machines collected yet");

    for (let i = 0; i <= 6; i++) {
      await gc.collect(gc.pollInterval);
    }

    assert.ok(collected[mid1], `Machine ${mid1} should be collected`);
    assert.ok(!collected[mid2], `Machine ${mid2} should not collected`);
  });

  it("should release machines", async () => {
    //
    gc.idleTimeout = 30 * 60 * 1000; // 30 minutes
    gc.pollInterval = 5 * 60 * 1000; // 1 minutes
    gc.onShouldRelease = async (mid) => {
      await roomManager.deleteMachine(mid);
    };

    let roomId = "room1";

    let mid = await roomManager.getOrCreateMachineForRoom({
      roomId,
    });

    await assertRoomMachine(roomId, mid);

    await roomManager.pool.api.stopMachine(mid, true);
    roomManager.clearJoins(roomId);

    for (let i = 0; i <= 6; i++) {
      await gc.collect(gc.pollInterval);
    }

    const machine = await roomManager.pool.api.getMachine(mid);

    assert.ok(machine, "Machine should exist");
    assert.equal(
      roomManager.pool.isFree(machine),
      true,
      "Machine should be free"
    );
  });

  it("should handle concurrent joins", async () => {
    //
    let lateJoinId = "";
    let roomId = "room1";

    gc.idleTimeout = 30 * 60 * 1000; // 30 minutes
    gc.pollInterval = 5 * 60 * 1000; // 1 minutes
    gc.onShouldRelease = async (mid) => {
      await Promise.all([
        roomManager.deleteMachine(mid).catch((e) => {}),
        roomManager.getOrCreateMachineForRoom({ roomId }).then((mid) => {
          lateJoinId = mid;
        }),
      ]);
    };

    let mid = await roomManager.getOrCreateMachineForRoom({
      roomId,
    });

    await assertRoomMachine(roomId, mid);

    await roomManager.pool.api.stopMachine(mid, true);
    roomManager.clearJoins(roomId);

    for (let i = 0; i <= 6; i++) {
      await gc.collect(gc.pollInterval);
    }

    if (lateJoinId === mid) {
      console.log("machine was reused", lateJoinId);
    }
    const machine = await roomManager.pool.api.getMachine(lateJoinId);
    assert.ok(machine, "Machine should exist");
    await assertRoomMachine(roomId, lateJoinId);
  });
});
