import { BackgroundJob } from "./job";
import { MachinesPool, PoolMachine } from "./MachinesPool";

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
  private _healthCheckUrl: (mid) => string;
  private _job: BackgroundJob;

  private _machinesIdleTimes = new Map<string, number>();

  constructor(opts: {
    pool: MachinesPool;
    pollInterval: number;
    healthCheckUrl: (mid) => string;
  }) {
    //
    this.pool = opts.pool;
    this._healthCheckUrl = opts.healthCheckUrl;
    this._job = new BackgroundJob({
      id: "machines-gc",
      task: () => this._process(),
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

  async shouldGarbageCollect(machine: PoolMachine) {
    // send a health check request to the machine
    // if the machine is not reachable, then it should be garbage collected
    const idleTimeout = machine.poolMetadata.idleTimeout;
    const currentIdleTime = this._machinesIdleTimes.get(machine.id) ?? 0;

    try {
    } catch (e) {
      return true;
    }
  }

  /**
   * This method should be called periodically to check the state of the machines
   * It'll return all pool machines
   */
  getMachinesToCollect(machines: PoolMachine[]) {
    //
    return machines.filter((machine) => this.shouldGarbageCollect(machine));
  }

  async _process() {
    //
    const machines = await this.pool.getClaimedMachines();

    const machinesToCollect = this.getMachinesToCollect(machines);

    for (const machine of machinesToCollect) {
      await this.pool.relaseMachine(machine.id);
    }
  }
}
