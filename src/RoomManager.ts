import { DbService } from "./db";
import { ResourceLock } from "./lock";
import { MachinesGC } from "./MachineGC";
import { MachinesPool, PoolOpts } from "./MachinesPool";
import { ServerSpecs, serverSpecsSchema } from "./schemas";
import { MachineConfig } from "./types";

export interface GetRoomMachineOpts {
  roomId: string;
  region?: string;
  ip?: string;
  specs?: boolean;
}

export class RoomManager {
  //
  pool: MachinesPool;
  joinReqs = new Map<string, Promise<string>>();
  joins = new Map<string, string>();
  roomLock = new ResourceLock();

  constructor(opts: { pool: MachinesPool }) {
    //
    this.pool = opts.pool;
  }

  async getOrCreateMachineForRoom(opts: GetRoomMachineOpts) {
    //
    let roomId = opts.roomId;

    let machineId = this.joins.get(roomId);

    if (machineId != null) {
      // ensure the machine hasn't been deleted meantime
      let machine = await this.pool.api.getMachine(machineId);
      if (machine != null) {
        this.joins.set(roomId, machineId);
        return machineId;
      } else {
        this.joins.delete(roomId);
      }
      machineId = null;
    }

    let joinReq = this.joinReqs.get(roomId);

    if (joinReq != null) {
      return joinReq;
    }

    this.roomLock.acquire(roomId, 0, "getOrCreateMachineForRoom");
    const req = this._getOrCreateMachineMutex(opts);

    req
      .then(
        (mid) => {
          this.joins.set(roomId, mid);
          this.joinReqs.delete(roomId);
          // console.log("joins.set", roomId, mid);
        },
        (e) => {
          this.joinReqs.delete(roomId);
          throw e;
        }
      )
      .finally(() => {
        //
        // console.log("joins", Array.from(this.joins.keys()));
        this.roomLock.release(roomId, "getOrCreateMachineForRoom");
      });

    this.joinReqs.set(roomId, req);

    return req;
  }

  async _getOrCreateMachineMutex(opts: GetRoomMachineOpts) {
    //
    const { roomId, region } = opts;

    let machineId = await this.getRoomMachine(roomId);

    if (machineId != null && !this.pool.isLocked(machineId)) {
      return machineId;
    }

    let config: Partial<MachineConfig> = null;

    if (opts.specs) {
      config = await this.getMachineConfig(roomId);
    }

    // Not found, get a new machine from the pool
    let mid = await this.pool.getMachine({ region, config, tag: roomId });

    await this.pool.api.startMachine(mid, true);

    if (mid == null) {
      throw new Error("Failed to get machine from pool for room " + roomId);
    }

    // associate the machine with the room
    await this.pool._api.updateMachineMetadata(mid, "roomId", roomId);

    return mid;
  }

  async getRoomMachine(roomId: string) {
    //
    let machine = await this.pool.getMachineByTag(roomId);

    if (machine == null) {
      return null;
    }

    if (this.pool.isLocked(machine.id)) {
      console.log("Machine was locked meantime", machine.id);
      return null;
    }

    // ensure the machine is running
    if (machine.state != "started") {
      await this.pool.api.startMachine(machine.id, true);
    }

    return machine.id;
  }

  async getMachines() {
    //
    const machines = await this.pool._api.getMachines();

    return machines.map((m) => {
      //
      return {
        id: m.id,
        state: m.state,
        region: m.region,
        cpu_kind: m.config.guest.cpu_kind,
        cpus: m.config.guest.cpus,
        memory_mb: m.config.guest.memory_mb,
        roomId: this.pool.getMachineTag(m),
        pooled: this.pool.isPooled(m),
      };
    });
  }

  async getMachineConfig(roomId: string) {
    //

    let config: Partial<MachineConfig> = null;

    let serverSpecs = await this._getServerSpecs(roomId);

    if (serverSpecs) {
      config = {
        env: {
          ROOM_IDLE_TIMEOUT_SEC: serverSpecs.idleTimeout,
        },
        guest: {
          cpu_kind: serverSpecs.guest.cpu_kind,
          cpus: serverSpecs.guest.cpus,
          memory_mb: serverSpecs.guest.memory_mb,
        },
      };
    }

    return config;
  }

  async _getServerSpecs(roomId: string) {
    //
    let serverSpecs: ServerSpecs;
    let gameMeta;

    try {
      //
      gameMeta = await DbService.getGameMetadata(roomId);
    } catch (e) {
      console.error("Failed to get game meta for " + roomId, e);
    }

    if (gameMeta?.serverSpecs) {
      //
      try {
        serverSpecs = serverSpecsSchema.parse(gameMeta.serverSpecs);
      } catch (e) {
        console.error("Invalid server specs for " + roomId, e);
      }
    }

    return serverSpecs;
  }

  _ensureNoJoin(roomId: string) {
    //
    if (this.joinReqs.has(roomId)) {
      throw new Error("Room is being prepared");
    }

    if (this.joins.has(roomId)) {
      throw new Error("Room is joined");
    }

    if (this.roomLock.isLocked(roomId)) {
      throw new Error("Room is locked");
    }
  }

  async deleteRoom(roomId: string) {
    //
    try {
      this.roomLock.acquire(roomId, 0, "deleteRoom");
      this.clearJoins(roomId);
      this._ensureNoJoin(roomId);
      // console.log("deleteRoom", roomId, "start");
      const machine = await this.pool.getMachineByTag(roomId);
      if (machine == null) {
        return false;
      }
      // console.log("deleteRoom", roomId, "got machine", machine.id);
      this._ensureNoJoin(roomId);
      return this.pool.releaseMachine(machine.id);
    } finally {
      //
      this.roomLock.release(roomId, "deleteRoom");
    }
  }

  clearJoins(roomId: string) {
    //
    this.joinReqs.delete(roomId);
    this.joins.delete(roomId);
    this.roomLock.release(roomId, "clearJoins");
  }

  async deleteMachine(mid: string) {
    //
    try {
      this.roomLock.acquire(mid, 0, "deleteMachine");
      this.clearJoins(mid);
      const machine = await this.pool.api.getMachine(mid);
      if (machine == null) {
        return false;
      }
      const roomId = this.pool.getMachineTag(machine);
      if (!roomId) {
        return false;
      }
      return this.pool.releaseMachine(mid);
    } catch (e) {
      console.error("Failed to delete machine", mid, e);
      return false;
    } finally {
      this.roomLock.release(mid, "deleteMachine");
    }
  }
}
