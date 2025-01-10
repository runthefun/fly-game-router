// import { Db } from "./db";
import { ENV } from "./env";
import type { FlyApi } from "./FlyApi";
import { BackgroundJob } from "./job";
import { ResourceLock } from "./lock";
import { CreateMachineOpts, Machine, MachineConfig } from "./types";
import { delay, mergeConfigs, precondition } from "./utils";

const DEFAULTS = {
  minSize: 10,
  maxSize: 100,
  pollInterval: 5 * 60 * 1000,
  machineIdleTimeout: 30 * 60 * 1000,
};

interface GetMachineOpts {
  tag?: string;
  region?: string;
  ip?: string;
  idleTimeout?: number;
  config?: Partial<MachineConfig>;
}

export interface PoolOpts {
  poolId?: string;
  minSize?: number;
  maxSize?: number;
  pollInterval?: number;
  templateApp: string;
  templateMachineId: string;
  api?: FlyApi;
}

/**
 * A class to manage a pool of machines;
 * the Pool strives to always have a number of stopped machines ready to start.
 * (starting a stopped in fly.io is always much faster than creating a new machine)
 *
 * The pool can be configured to have a min and max size, and will scale up and down
 * to keep always minSize machines stopped.
 * The pool will stop scaling up when it reaches maxSize.
 * The pool will also stop scaling down when it reaches minSize.
 *
 */
export class MachinesPool {
  //
  _eventLogger = new EventLogger();
  _machines: Map<string, Machine> = new Map();
  _freeSize: number = 0;
  _poolSize: number = 0;

  _machinesLock = new ResourceLock();
  _job: BackgroundJob;

  _scaleErrorCounnt = 0;

  _active: boolean = false;

  _poolId: string;
  _templateApp: string;
  _templateMachineId: string;

  _currentMaintain: Promise<unknown> = null;

  _minSize: number;
  _maxSize: number;
  _pollInterval: number;
  _api: FlyApi;

  _reqCountsByRegion: Record<string, number> = {};

  constructor(opts?: PoolOpts) {
    //
    this._poolId = opts?.poolId ?? ENV.FLY_MACHINE_ID;

    this._minSize = opts?.minSize || DEFAULTS.minSize;
    this._maxSize = opts?.maxSize || DEFAULTS.maxSize;

    this._job = new BackgroundJob({
      id: "pool-" + this._poolId,
      task: () => this.scale(),
      pollInterval: opts.pollInterval || DEFAULTS.pollInterval,
    });

    this._templateApp = opts?.templateApp;
    this._templateMachineId = opts?.templateMachineId;
    this._api = opts?.api;
  }

  private _curRefresh: Promise<unknown> = null;

  refresh() {
    //
    if (this._curRefresh == null) {
      //
      let curRefresh = this._api
        .getMachines()
        .then((machines) => {
          //
          let freeSize = 0;

          let poolMachines = machines
            .filter((m) => this.isPooled(m))
            .map((m) => {
              // if the machine is currently being written to locally, return the local version
              if (this.isLocked(m.id)) {
                return this._machines.get(m.id) || m;
              }

              if (this.isFree(m)) {
                freeSize++;
              }

              return m;
            });

          this._poolSize = poolMachines.length;
          this._freeSize = freeSize;

          this._machines = new Map(poolMachines.map((m) => [m.id, m]));
        })
        .finally(() => {
          this._curRefresh = null;
        });

      this._curRefresh = curRefresh;
    }

    return this._curRefresh;
  }

  config(
    opts: {
      minSize?: number;
      maxSize?: number;
      pollInterval?: number;
      sourceMachineId?: string;
    } = {}
  ) {
    //
    if (opts.minSize) this._minSize = opts.minSize;
    if (opts.maxSize) this._maxSize = opts.maxSize;
    if (opts.sourceMachineId) this._templateMachineId = opts.sourceMachineId;

    if (opts.pollInterval) {
      this._job.pollInterval = opts.pollInterval;
    }
  }

  async reset(opts?: { force?: boolean }) {
    //
    const res = await this.getMachines();
    await Promise.all(
      res
        .filter(
          (m) => opts?.force || (m.state !== "started" && !this.isLocked(m.id))
        )
        .map(async (m) => {
          try {
            if (m.state === "started") {
              await this.api.stopMachine(m.id, true);
            }
            this._deleteMachine(m);
          } catch (err) {
            console.error(err);
          }
        })
    );
  }

  get active() {
    return this._job.active;
  }

  start() {
    this._job.start();
  }

  stop() {
    this._job.stop();
    this.reset();
  }

  async scale() {
    //
    try {
      await this.refresh();

      let minSize = this._minSize;
      let maxSize = this._maxSize;

      let machines = Array.from(this._machines.values());

      const all = machines.filter((m) => this.isPooled(m));

      const available = all.filter((m) => this.isFree(m));

      // console.log(
      //   "scaling",
      //   minSize,
      //   maxSize,
      //   "overall",
      //   machines.length,
      //   "all",
      //   all.length,
      //   "free",
      //   available.length
      // );

      const diff = Math.min(minSize - available.length, maxSize - all.length);

      if (diff > 0) {
        // console.log("scaling up", diff);
        await Promise.all(
          Array.from({ length: diff }).map(async () => {
            try {
              await this._createPooledMachine({ tag: "free" });
            } catch (e) {
              console.error("Failed to create machine", e);
            }
          })
        );
      } else if (diff < 0) {
        //
        // console.log("scaling down", Math.abs(diff));
        const toDelete = Math.abs(diff);

        let machinesToDelete = available.slice(0, toDelete);

        await Promise.all(
          machinesToDelete.map(async (machine) => {
            //
            try {
              await this._deleteMachine(machine);
            } catch (e) {
              //
              console.error("Failed to delete machine", e);
            }
          })
        );
      }
    } catch (e) {
      //
      console.error("Error scaling", e);

      this._scaleErrorCounnt++;

      // if too much consecutive errors, stop the pool
      if (this._scaleErrorCounnt > 100) {
        this.stop();
      }
      // force a refresh to make sure we're in a consistent state
      this.refresh();
    }
  }

  private get _poolKey() {
    //
    return `pool:${this._poolId}`;
  }

  private _deleteMachine(m: Machine) {
    //
    if (this.isLocked(m.id)) return;

    return this._machinesLock.tryWithLock(
      m.id,
      async () => {
        //
        await this._api.deleteMachine(m.id, { force: true });
        this._machines.delete(m.id);
      },
      0,
      "delete"
    );
  }

  private _updateMachineState(m: Machine, state: string) {
    //

    return this._machinesLock.tryWithLock(
      m.id,
      async () => {
        //
        //console.log("[POOL] updateMachineState", m.id, state);

        await this._api.updateMachineMetadata(
          m.id,
          // for quick lookup on
          this._poolKey,
          state
        );

        m.config.metadata[this._poolKey] = state;
      },
      0,
      "state=" + state
    );
  }

  getMachineTag(m: Machine) {
    return m.config.metadata[this._poolKey];
  }

  isPooled(machine: Machine): boolean {
    //
    return this.getMachineTag(machine) != null;
  }

  isLocked(machineId: string) {
    return this._machinesLock.isLocked(machineId);
  }

  lockMachine(machineId: string, ttl: number, reason?: string) {
    return this._machinesLock.acquire(machineId, ttl, reason);
  }

  unlockMachine(machineId: string, reason?: string) {
    return this._machinesLock.release(machineId, reason);
  }

  _unsafe_unlockAll() {
    return this._machinesLock._unsafe_clear();
  }

  tryWithLock<T>(machineId: string, task: () => Promise<T>, ttlAfter) {
    return this._machinesLock.tryWithLock(machineId, task, ttlAfter);
  }

  isFree(m: Machine): boolean {
    //
    return (
      this.isPooled(m) &&
      !this.isLocked(m.id) &&
      this.getMachineTag(m) === "free"
    );
  }

  isClaimed(m: Machine): boolean {
    //
    return this.isPooled(m) && this.getMachineTag(m) !== "free";
  }

  async getPoolSize() {
    //
    await this.refresh();
    const machines = Array.from(this._machines.values());
    const free = machines.filter((m) => this.isFree(m)).length;
    const total = machines.filter((m) => this.isPooled(m)).length;

    return { free, total };
  }

  async getFreeMachines() {
    //
    await this.refresh();
    const machines = Array.from(this._machines.values());
    return machines.filter((m) => this.isFree(m));
  }

  async getMachines() {
    //
    await this.refresh();

    return Array.from(this._machines.values());
  }

  async getMachine(opts?: GetMachineOpts): Promise<string> {
    //
    let event: PoolEvent = {
      type: "machine-request",
      region: opts?.region ?? "",
      ip: opts?.ip ?? "",
      result: "failure",
      machineId: null,
      poolId: null,
      poolSize: 0,
      freeSize: 0,
      config: opts?.config,
    };

    if (opts?.region) {
      //
      this._reqCountsByRegion[opts?.region] ??= 0;
      this._reqCountsByRegion[opts?.region]++;
    }

    try {
      const pooledMachines = await this.getMachines();
      const freeMachines = pooledMachines.filter((m) => this.isFree(m));

      const m = freeMachines.find((m) => this.isLocked(m.id));
      if (m) {
        throw new Error("Machine is locked " + m.id);
      }

      event.poolSize = pooledMachines.length;
      event.freeSize = freeMachines.length;

      // console.log(
      //   "[POOL] getMachine",
      //   "region",
      //   opts.region,
      //   "free machines",
      //   freeMachines.length
      // );

      let machine: Machine = null;

      // When asking for a specific config, we always create a non pooled machine
      if (!opts?.config) {
        //
        if (opts?.region) {
          machine = freeMachines.find((m) => m.region === opts.region);
        }

        machine ??= freeMachines[0];
      }

      if (machine) {
        //
        // console.log("[POOL] getMachine", "found free machine", machine.id);

        try {
          let res = this._updateMachineState(machine, opts?.tag || "claimed");

          if (!res) {
            throw new Error("Failed to claim machine");
          }

          await res;

          event.result = "success";
          event.machineId = machine.id;
          event.poolId = this._poolId;

          return machine.id;
        } catch (e) {
          //
          console.error(e);

          if (this.isLocked(machine.id)) {
            this._machinesLock.release(machine.id);
          }
          // restore the machine state
          this._updateMachineState(machine, "free");

          machine = null;
        }
      }

      if (machine == null) {
        // console.log(
        //   "[POOL] getMachine",
        //   "No free machine in pool, creating new machine"
        // );
        const npMachine = await this._createPooledMachine(opts);

        // console.log(
        //   "[POOL] getMachine",
        //   "created new machine",
        //   npMachine?.config.metadata
        // );

        event.result = "success";
        event.machineId = npMachine.id;
        event.poolId = null;

        //
        return npMachine.id;
      }
    } finally {
      //
      this._eventLogger.logEvent(event);
    }
  }

  async releaseMachine(machineId: string) {
    //
    if (this.isLocked(machineId)) {
      console.error("Machine is locked", machineId);
      return false;
    }

    try {
      this.lockMachine(machineId, 5000, "release");

      const machine = await this._api.getMachine(machineId);

      if (machine == null) {
        console.error("Machine not found", machineId);
        return false;
      }

      if (machine.state !== "stopped") {
        //
        try {
          await this._api.stopMachine(machineId, true);
          machine.state = "stopped";
        } catch (e) {
          console.error("Failed to stop machine", e);
          return false;
        }
      }

      try {
        precondition(machine, "Machine not found");
        precondition(!this.isFree(machine), "Machine not claimed");
        precondition(machine.state === "stopped", "Machine not stopped");
      } catch (e) {
        console.error("Release precondition failed", e);
        return false;
      }

      // release lock for update task
      this.unlockMachine(machineId, "release");
      await this._updateMachineState(machine, "free");

      this._eventLogger.logEvent({
        type: "machine-release",
        result: "success",
        machineId: machine.id,
        poolId: this._poolId,
        poolSize: this._poolSize,
        freeSize: this._freeSize,
      });

      return true;
    } catch (e) {
      console.error("Failed to release machine", e);
      return false;
    } finally {
      this.unlockMachine(machineId, "release");
    }
  }

  private async _createPooledMachine(opts?: GetMachineOpts) {
    //
    const machine = await this._createMachineWithRetry((m) => ({
      config: mergeConfigs(m.config, opts?.config, {
        metadata: {
          [this._poolKey]: opts?.tag || "free",
          ref: m.id,
        },
      }),
      skip_launch: true,
      region: opts?.region || m.region,
    }));

    await this._api.waitMachine(machine.id, {
      state: "stopped",
      instance_id: machine.instance_id,
    });

    return machine;
  }

  maxCreateRetries = 3;

  private async _createMachineWithRetry(
    onOpts: (data: Machine) => CreateMachineOpts
  ) {
    //
    if (!this._templateMachineId) {
      throw new Error("Source machine id not set");
    }

    for (let i = 0; i < this.maxCreateRetries; i++) {
      try {
        //
        let m = await this._api.cloneMachine(
          this._templateApp,
          this._templateMachineId,
          onOpts
        );

        await this._api.waitMachine(m.id, {
          state: "stopped",
          instance_id: m.instance_id,
        });

        return m;
      } catch (e) {
        if (e.cause !== "api-mock") {
          console.error("Error creating machine", e);
        }
        await delay(500);
      }
    }

    throw new Error("Failed to create machine");
  }

  get api() {
    return this._api;
  }

  async getMachineByTag(tag: string) {
    //
    const machines = await this.api.getMachinesByMetadata({
      [this._poolKey]: tag,
    });
    if (machines.length == 0) return null;
    const m = machines[0];
    if (this.isLocked(m.id)) return null;
    return m;
  }

  async getClaimedMachines() {
    //
    await this.refresh();

    return Array.from(this._machines.values()).filter(
      (m) => !this.isLocked(m.id) && !this.isFree(m)
    );
  }
}

interface RequestPoolEvent {
  type: "machine-request";
  region?: string;
  ip?: string;
  result: "success" | "failure";
  machineId: string;
  poolId: string;
  poolSize: number;
  freeSize: number;
  config?: Partial<MachineConfig>;
}

interface ReleasePoolEvent {
  type: "machine-release";
  result: "success" | "failure";
  machineId: string;
  poolId: string;
  poolSize: number;
  freeSize: number;
}

type PoolEvent = RequestPoolEvent | ReleasePoolEvent;

class EventLogger {
  //
  // _db = Db._db;

  constructor() {
    this.init();
  }

  init() {}

  logEvent(e: PoolEvent) {
    //
    // if (ENV.IS_PRODUCTION) {
    //   dblogEvent(e);
    // }
  }
}
