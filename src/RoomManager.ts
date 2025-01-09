import { DbService } from "./db";
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

  constructor(opts: { pool: MachinesPool }) {
    //
    this.pool = opts.pool;
  }

  joinReqs = new Map<string, Promise<string>>();

  async getOrCreateMachineForRoom(opts: GetRoomMachineOpts) {
    //
    let roomId = opts.roomId;

    let joinReq = this.joinReqs.get(roomId);

    if (joinReq != null) {
      return joinReq;
    }

    const req = this._getOrCreateMachineMutex(opts);

    this.joinReqs.set(roomId, req);

    req.finally(() => {
      setTimeout(() => this.joinReqs.delete(roomId), 2000);
    });

    return req;
  }

  async _getOrCreateMachineMutex(opts: GetRoomMachineOpts) {
    //
    const { roomId, region } = opts;

    let machineId = await this.getRoomMachine(roomId);

    if (machineId != null) {
      return machineId;
    }

    let config: Partial<MachineConfig> = null;

    if (opts.specs) {
      config = await this.getMachineConfig(roomId);
    }

    // Not found, get a new machine from the pool
    let mid = await this.pool.getMachine({ region, config });

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
    let machines = await this.pool._api.getMachinesByMetadata({
      roomId,
    });

    if (machines.length == 0) {
      return null;
    }

    const machine = machines[0];

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
        roomId: m.config.metadata.roomId,
        pooled: this.pool.isPooled(m),
      };
    });
  }

  async getMachineConfig(roomId: string) {
    //

    let config: Partial<MachineConfig> = null;
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
}
