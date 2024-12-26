import { MachinesPool, PoolOpts } from "./MachinesPool";

export class RoomManager {
  //
  pool: MachinesPool;

  constructor(opts: PoolOpts) {
    //
    this.pool = new MachinesPool(opts);
  }

  joinReqs = new Map<string, Promise<string>>();

  async getOrCreateMachineForRoom(opts: {
    roomId: string;
    region?: string;
    ip?: string;
  }) {
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

  async _getOrCreateMachineMutex(opts: {
    roomId: string;
    region?: string;
    ip?: string;
  }) {
    //
    const { roomId, region } = opts;

    // Find a machine that is already running for the room
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

    if (machine != null) {
      return machine.id;
    }

    // Not found, get a new machine from the pool
    let mid = await this.pool.getMachine({ region });

    if (mid == null) {
      throw new Error("Failed to get machine from pool for room " + roomId);
    }

    // associate the machine with the room
    await this.pool._api.updateMachineMetadata(mid, "roomId", roomId);

    return mid;
  }
}
