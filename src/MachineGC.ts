import { BackgroundJob } from "./job";
import { MachinesPool } from "./MachinesPool";
import { Machine } from "./types";

/**
 * This class is responsible for the garbage collection of machines create from MachinesPool.
 * Basically, any machine that stays idle for a certain amount of time
 * is considered garbage and should be released back to the pool.
 *
 * A machine is in idle state if it's in stopped state
 */
export class MachinesGC {
  //
  showLogs = true;

  pool: MachinesPool;
  private _job: BackgroundJob;
  private _idleTimeout: number;
  private _onShouldRelease: (mid: string) => unknown;

  private _machinesIdleTimes = new Map<string, number>();

  constructor(opts: {
    pool: MachinesPool;
    pollInterval: number;
    idleTimeout: number;
    onShouldRelease: (mid: string) => unknown;
  }) {
    //
    this.pool = opts.pool;

    this._idleTimeout = opts.idleTimeout;

    this._job = new BackgroundJob({
      id: "machines-gc",
      task: () => this.collect(this.pollInterval),
      pollInterval: opts.pollInterval,
    });

    this._onShouldRelease = opts.onShouldRelease;
  }

  config(opts: { pollInterval: number }) {
    //
    this._job.pollInterval = opts.pollInterval;
  }

  get active() {
    return this._job.active;
  }

  get pollInterval() {
    return this._job.pollInterval;
  }

  set pollInterval(value: number) {
    this._job.pollInterval = value;
  }

  get idleTimeout() {
    return this._idleTimeout;
  }

  set idleTimeout(value: number) {
    this._idleTimeout = value;
  }

  get onShouldRelease() {
    return this._onShouldRelease;
  }

  set onShouldRelease(value: (mid: string) => unknown) {
    this._onShouldRelease = value;
  }

  _log(...args: any[]) {
    if (!this.showLogs) return;
    console.log("[GC]", ...args);
  }

  _error(...args: any[]) {
    console.error("[GC]", ...args);
  }

  start() {
    //
    this._log("Garbage Collector started");
    this._job.start();
  }

  stop() {
    //
    this._log("Garbage Collector stopped");
    this._job.stop();
  }

  async collect(dt: number) {
    //
    this._log("Collecting idle machines...");
    const claimedMachines = await this.pool.getClaimedMachines();

    const stoppedMachines = claimedMachines.filter(
      (m) => m.state === "stopped"
    );

    let machinesToCollect: Machine[] = [];

    let prevTimeouts = this._machinesIdleTimes;
    this._machinesIdleTimes = new Map<string, number>();

    stoppedMachines.forEach((machine) => {
      //
      const idleTimeout = this._idleTimeout;
      let currentIdleTime = prevTimeouts.get(machine.id) ?? 0;

      // console.log(
      //   "Machine idle time",
      //   machine.id,
      //   currentIdleTime / (60 * 1000),
      //   "minutes",
      //   "/",
      //   idleTimeout / (60 * 1000),
      //   "minutes"
      // );

      if (currentIdleTime >= idleTimeout) {
        this._log(
          "Machine",
          machine.id,
          "for room",
          this.pool.getMachineTag(machine),
          "reached idle timeout. Releasing..."
        );
        machinesToCollect.push(machine);
      } else {
        this._machinesIdleTimes.set(machine.id, currentIdleTime + dt);
      }
    });

    let collected: Machine[] = [];

    await Promise.all(
      machinesToCollect.map((machine) => {
        //
        return Promise.resolve(this.onShouldRelease(machine.id)).then(
          () => collected.push(machine),
          (e) => {
            this._error("Error while releasing machine", machine.id, e);
          }
        );
      })
    );

    this._log("Collected", collected.length, "machines");
  }

  touchMachine(mid: string) {
    this._machinesIdleTimes.set(mid, 0);
  }
}
