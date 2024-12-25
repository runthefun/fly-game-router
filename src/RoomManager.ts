import { MachinesPool, PoolOpts } from "./MachinesPool";

export class RoomManager {
  //
  pool: MachinesPool;

  constructor(opts: PoolOpts) {
    //
    this.pool = new MachinesPool(opts);
  }

  joinReqs = new Map<string, Promise<string>>();

  async getOrCreateMachineForRoom(roomId: string) {
    //
    let joinReq = this.joinReqs.get(roomId);

    if (joinReq != null) {
      return joinReq;
    }

    const req = this._getOrCreateMachineMutex(roomId);

    this.joinReqs.set(roomId, req);

    req.finally(() => {
      setTimeout(() => this.joinReqs.delete(roomId), 2000);
    });

    return req;
  }

  async _getOrCreateMachineMutex(roomId: string) {
    //

    // Find a machine that is already running for the room
    let machines = await this.pool._api.getMachinesByMetadata({
      roomId,
    });

    let machine = machines?.find((m) => m.state === "started");

    if (machine != null) {
      return machine.id;
    }

    // Not found, get a new machine from the pool
    let mid = await this.pool.getMachine();

    if (mid == null) {
      throw new Error("Failed to get machine from pool for room " + roomId);
    }

    // associate the machine with the room
    await this.pool._api.updateMachineMetadata(mid, "roomId", roomId);

    return mid;
  }
}
