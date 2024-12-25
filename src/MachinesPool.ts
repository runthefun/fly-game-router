// import { Db } from "./db";
import { FlyApi } from "./FlyApi";
import { defaultConfig } from "./machine.config";
import { CreateMachineOpts, CreateMachineOptsNoConfig, Machine } from "./types";

interface Claim {
  uid: string;
  mid: string;
  ts: number;
}

const DEFAULTS = {
  minSize: 10,
  maxSize: 100,
  pollInterval: 5 * 60 * 1000,
};

interface GetMachineOpts {
  tag?: string;
  env?: Record<string, string>;
}

export interface PoolOpts {
  minSize?: number;
  maxSize?: number;
  pollInterval?: number;
  sourceMachineId: string;
  api?: FlyApi;
}

export class MachinesPool {
  //
  _eventLogger = new EventLogger();
  _machines: Machine[] = [];

  _interval: NodeJS.Timeout;
  _active: boolean = false;

  _sourceMachineId: string;

  _currentMaintain: Promise<unknown> = null;

  _minSize: number;
  _maxSize: number;
  _pollInterval: number;
  _api: FlyApi;

  constructor(opts?: PoolOpts) {
    //
    this._minSize = opts?.minSize || DEFAULTS.minSize;
    this._maxSize = opts?.maxSize || DEFAULTS.maxSize;
    this._pollInterval = opts?.pollInterval || DEFAULTS.pollInterval;

    this._sourceMachineId = opts?.sourceMachineId;
    this._api = opts?.api ?? FlyApi.default;
  }

  /*
    since api is async, it's possible that we'd get concurrent
    requests trying to start the same machine. So we put a lock
    to ensure that only one request is starting the machine
    
    To avoid subtle bugs, we follow the below rules:

      1. A machine can be claimed if it's in the server free list
         and not in the local claimed list
      2. Once a machine is claimed, it'll be started immediately
      3. Once machine start has been confirmed, IT'S IMPORTANT TO
         NOT REMOVE IT RIGHT AWAY. This is because inflight requests
         might still see a stale state (eg stopped) from the server
      4. Instead, we wait some minimal time (eg 1s) before removing to 
         let inflight requests settle first and see the claimed state

    */
  _claims: Record<string, Claim> = {};

  _claimMachine(mid: string) {
    //
    if (this._claims[mid]) {
      throw new Error(`Machine ${mid} already claimed`);
    }

    let uid = Math.random().toString(36).substring(7);

    let claim = (this._claims[mid] = { uid, mid, ts: Date.now() });

    return claim;
  }

  _removeClaim(c: Claim) {
    //
    let cur = this._claims[c.mid];

    if (cur == null) {
      throw new Error(`Machine ${c.mid} not claimed`);
    }

    if (c.uid !== cur.uid) {
      throw new Error(`Claim ${c.uid} does not match ${cur.uid}`);
    }

    delete this._claims[c.mid];
  }

  config(
    opts: {
      minSize?: number;
      maxSize?: number;
      sourceMachineId?: string;
    } = {}
  ) {
    //
    if (opts.minSize) this._minSize = opts.minSize;
    if (opts.maxSize) this._maxSize = opts.maxSize;
    if (opts.sourceMachineId) this._sourceMachineId = opts.sourceMachineId;
  }

  async reset() {
    //
    if (this._active) this.stop();
    const res = await this.getMachines();
    await Promise.all(
      res.all.map((m) => this._api.deleteMachine(m.id, { force: true }))
    );
    this._machines = [];
  }

  async refresh() {
    //
    this._machines = await this._api.getMachines();
  }

  get active() {
    return this._active;
  }

  start() {
    //
    if (this._active) {
      console.warn("Already started");
      return;
    }

    this._active = true;

    this._interval = setInterval(this._onMaintain, this._pollInterval);
  }

  _onMaintain = () => {
    //
    if (this._currentMaintain == null) {
      this._currentMaintain = this.scale().finally(() => {
        this._currentMaintain = null;
      });
    }

    //
  };

  stop() {
    //
    if (!this._active) {
      console.warn("Already stopped");
      return;
    }

    this._active = false;
    clearInterval(this._interval);
  }

  private _isScaling = false;

  async scale() {
    //
    if (this._isScaling) {
      console.warn("Already scaling");
      return;
    }

    try {
      await this.refresh();

      let minSize = this._minSize;
      let maxSize = this._maxSize;

      const all = this._machines.filter((m) => this.isPooled(m));

      const available = all.filter((m) => this.isFree(m));

      const diff = Math.min(minSize - available.length, maxSize - all.length);

      if (diff > 0) {
        await Promise.all(
          Array.from({ length: diff }).map(async () => {
            await this._createPooledMachine().catch((e) => {
              //
              console.error("Failed to create machine", e);
            });
          })
        );
      } else if (diff < 0) {
        const toDelete = Math.abs(diff);
        await Promise.all(
          available.slice(0, toDelete).map(async (m) => {
            await this._api.deleteMachine(m.id, { force: true }).catch((e) => {
              //
              console.error("Failed to delete machine", e);
            });
          })
        );
      }
    } finally {
      this._isScaling = false;
    }
  }

  isPooled(machine: Machine): boolean {
    //
    return machine.config.metadata?.pooled === "true";
  }

  isFree(m: Machine): boolean {
    //
    return (
      this.isPooled(m) &&
      (m.state === "created" ||
        m.state === "stopping" ||
        m.state === "stopped" ||
        m.state === "suspending" ||
        m.state === "suspended") &&
      !this._claims[m.id]
    );
  }

  async getPoolSize() {
    //
    await this.refresh();
    const free = this._machines.filter((m) => this.isFree(m)).length;
    const total = this._machines.filter((m) => this.isPooled(m)).length;

    return { free, total };
  }

  async getFreeMachines() {
    //
    await this.refresh();
    return this._machines.filter((m) => this.isFree(m));
  }

  async getMachines() {
    //
    await this.refresh();

    const all = this._machines.filter((m) => this.isPooled(m));
    const free = all.filter((m) => this.isFree(m));

    return { all, free };
  }

  async getMachine(tag?: string): Promise<string> {
    //
    let event: PoolEvent = {
      type: "machine-request",
      result: "failure",
      machineId: null,
      pooled: false,
      poolSize: 0,
      freeSize: 0,
    };

    try {
      const pooledMachines = await this.getMachines();
      const freeMachines = pooledMachines.free;

      event.poolSize = pooledMachines.all.length;
      event.freeSize = freeMachines.length;

      let machine = freeMachines?.[0];

      if (machine) {
        //
        let claim = this._claimMachine(machine.id);

        try {
          //
          await this._startMachine(machine);

          event.result = "success";
          event.machineId = machine.id;
          event.pooled = true;

          return machine.id;
          //
        } finally {
          setTimeout(() => {
            this._removeClaim(claim);
          }, 1000);
        }
      }

      if (machine == null) {
        machine = await this._createNonPooledMachine();
        //
        event.result = "success";
        event.machineId = machine.id;
        event.pooled = false;

        //
        return machine.id;
      }
    } finally {
      //
      this._eventLogger.logEvent(event);
    }
  }

  private async _createNonPooledMachine() {
    //
    return this._createMachineWithRetry(
      (m) => ({
        config: {
          ...m.config,
          auto_destroy: true,
        },
      }),
      true
    );
  }

  private async _createPooledMachine() {
    //
    const machine = await this._createMachineWithRetry(
      (m) => ({
        config: {
          ...m.config,
          metadata: {
            ...m.config.metadata,
            pooled: "true",
          },
        },
        skip_launch: true,
      }),
      false
    );

    await this._api.waitMachine(machine.id, {
      state: "stopped",
      instance_id: machine.instance_id,
    });

    return machine;
  }

  maxCreateRetries = 3;

  private async _createMachineWithRetry(
    onOpts: (data: Machine) => CreateMachineOpts,
    waitStart: boolean
  ) {
    //
    if (!this._sourceMachineId) {
      throw new Error("Source machine id not set");
    }

    for (let i = 0; i < this.maxCreateRetries; i++) {
      try {
        //
        let m = await this._api.cloneMachine(
          this._sourceMachineId,
          onOpts,
          waitStart
        );
        return m;
      } catch (e) {
        // console.error("Error creating machine", e);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new Error("Failed to create machine");
  }

  private async _startMachine(machine: Machine, tag?: string) {
    //
    if (machine.state !== "stopped") {
      await this._api.waitMachine(machine.id, {
        state: "stopped",
        instance_id: machine.instance_id,
      });
    }

    // const logger = tag
    //   ? (...args: string[]) => this._log(tag, args.join(" "))
    //   : null;
    await this._api.startMachine(machine.id, true /* logger */);
  }
}

interface PoolEvent {
  type: "machine-request";
  result: "success" | "failure";
  machineId: string;
  pooled: boolean;
  poolSize: number;
  freeSize: number;
}

class EventLogger {
  //
  // _db = Db._db;

  constructor() {
    this.init();
  }

  init() {
    //
    /*
    // create table for Events if not exists
    this._db.exec(`
        CREATE TABLE IF NOT EXISTS Events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER,
            type TEXT,
            result TEXT,
            machineId TEXT,
            pooled BOOLEAN,
            poolSize INTEGER,
            freeSize INTEGER
        )
    `);
    */
  }

  logEvent(e: PoolEvent) {
    //
    /*
    const stmt = this._db.prepare(
      "INSERT INTO Events (ts, type, result, machineId, pooled, poolSize, freeSize) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    stmt.run(
      Date.now(),
      e.type,
      e.result,
      e.machineId,
      String(e.pooled),
      e.poolSize,
      e.freeSize
    );
    */
    // console.log(e);
  }
}
