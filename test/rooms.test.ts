import assert from "assert";
import { FlyMockApi } from "./FlyMockApi";
import { RoomManager } from "../src/RoomManager";
import { defaultConfig } from "../src/machine.config";

let srcAppApi: FlyMockApi;
let api: FlyMockApi;

const MIN_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;
const POLL_INTERVAL = 100;

describe("RoomManager tests", () => {
  //
  let roomManager: RoomManager;

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

  beforeEach(() => {
    //
    roomManager = new RoomManager({
      minSize: MIN_POOL_SIZE,
      maxSize: MAX_POOL_SIZE,
      api,
      templateApp: "srcApp",
      templateMachineId: "mref",
    });
  });

  afterEach(async () => {
    //
    await roomManager.pool.reset();
  });

  it("should create a machine for a room", async () => {
    //

    await roomManager.pool.scale();

    let roomId = "room1";

    let mid = await roomManager.getOrCreateMachineForRoom(roomId);

    const machine = await api.getMachine(mid);

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

    let mid1 = await roomManager.getOrCreateMachineForRoom(roomId);
    let mid2 = await roomManager.getOrCreateMachineForRoom(roomId);

    const machine1 = await api.getMachine(mid1);

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

    let mid1 = await roomManager.getOrCreateMachineForRoom(roomId1);
    let mid2 = await roomManager.getOrCreateMachineForRoom(roomId2);

    const machine1 = await api.getMachine(mid1);
    const machine2 = await api.getMachine(mid2);

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

    let req1 = roomManager.getOrCreateMachineForRoom(roomId1);
    let req2 = roomManager.getOrCreateMachineForRoom(roomId1);

    let [mid1, mid2] = await Promise.all([req1, req2]);

    assert.equal(mid1, mid2, "Machine should be reused");

    const machine = await api.getMachine(mid1);

    assert.equal(machine?.state, "started", "Machine1 should be started");
    assert.equal(
      machine?.config.metadata.roomId,
      roomId1,
      "Machine should be for room1"
    );

    let req3 = roomManager.getOrCreateMachineForRoom(roomId1);

    let mid3 = await req3;

    assert.equal(mid1, mid3, "Machine should be reused");
  });
});
