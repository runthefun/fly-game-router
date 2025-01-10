import { BackgroundJob } from "./job";
import { MachinesPool } from "./MachinesPool";

/**
 * This class is responsible for the garbage collection of machines create from MachinesPool.
 * Basically, any machine that stays idle for a certain amount of time
 * is considered garbage and should be released back to the pool.
 *
 * A machine is in idle state if it's in stopped state
 */
export class MachinesGC {
  //
  pool: MachinesPool;
  private _job: BackgroundJob;
  private _idleTimeout: number;

  private _machinesIdleTimes = new Map<string, number>();

  constructor(opts: {
    pool: MachinesPool;
    pollInterval: number;
    idleTimeout: number;
    healthCheckUrl: (mid) => string;
  }) {
    //
    this.pool = opts.pool;

    this._idleTimeout = opts.idleTimeout;

    this._job = new BackgroundJob({
      id: "machines-gc",
      task: () => this.collect(),
      pollInterval: opts.pollInterval,
    });
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

  start() {
    //
    this._job.start();
  }

  stop() {
    //
    this._job.stop();
  }

  async collect() {
    //
    const claimedMachines = await this.pool.getClaimedMachines();

    const stoppedMachines = claimedMachines.filter(
      (m) => m.state === "stopped"
    );

    let machinesToCollect = [];

    let prevTimeouts = this._machinesIdleTimes;
    this._machinesIdleTimes = new Map<string, number>();

    stoppedMachines.forEach((machine) => {
      //
      const idleTimeout = this._idleTimeout;
      let currentIdleTime = prevTimeouts.get(machine.id) ?? 0;

      if (currentIdleTime >= idleTimeout) {
        machinesToCollect.push(machine);
      } else {
        this._machinesIdleTimes.set(
          machine.id,
          currentIdleTime + this.pollInterval
        );
      }
    });

    machinesToCollect.forEach((machine) => {
      //
      this.pool.releaseMachine(machine.id);
    });
  }

  touchMachine(mid: string) {
    this._machinesIdleTimes.set(mid, 0);
  }
}
