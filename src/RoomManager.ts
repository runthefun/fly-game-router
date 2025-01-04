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

  constructor(opts: PoolOpts) {
    //
    this.pool = new MachinesPool(opts);
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

    let machine = machines?.find(
      /*
        We need the isClaimed check since roomId is not cleaned up when the
        machine is stopped. So we might end up getting a machine that's in the 
        process of being prepared by the pool for another room.
      */
      (m) => m.state === "started" && !this.pool.isClaimed(m.id)
    );

    return machine?.id;
  }

  async getMachines() {
    //
    const machines = await this.pool._api.getMachines();

    return (
      machines
        // .filter((m) => m.state === "started" && !this.pool.isClaimed(m.id))
        .map((m) => {
          //
          return {
            id: m.id,
            state: m.state,
            region: m.region,
            cpu_kind: m.config.guest.cpu_kind,
            cpus: m.config.guest.cpus,
            memory_mb: m.config.guest.memory_mb,
            roomId: m.state === "started" ? m.config.metadata.roomId : "",
            pooled: this.pool.isPooled(m),
          };
        })
    );
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
