import { FlyApi } from "./FlyApi";
import { CreateMachineOpts, Machine } from "./types";

export class FlyMachine {
  //
  static async create(opts?: CreateMachineOpts) {
    //

    const machine = await FlyApi.default.createMachine(opts);

    return new FlyMachine({ machine });
  }

  static get(id: string) {
    //
    return FlyApi.default.getMachine(id);
  }

  static async getByMetadata(key: string, value: string) {
    //
    const machines = await FlyApi.default.getMachinesByMetadata({
      [key]: value,
    });

    if (machines.length === 0) {
      return null;
    }

    return new FlyMachine({ machine: machines[0] });
  }

  private _machine: Machine;

  private constructor(opts: { machine: Machine }) {
    //
    this._machine = opts.machine;
  }

  get app() {
    return FlyApi.default.appId;
  }

  get id() {
    return this._machine.id;
  }

  get metadata() {
    return this._machine.config.metadata;
  }

  waitStarted() {
    return FlyApi.default.waitMachine(this._machine.id, { state: "started" });
  }

  private async _refresh() {
    //
    this._machine = await FlyApi.default.getMachine(this.id);
  }

  async start() {
    //
    await this._refresh();

    if (this._machine.state === "started") {
      return;
    }

    if (this._machine.state === "destroyed") {
      throw new Error("Machine was destroyed");
    }

    if (this._machine.state == "created") {
      await FlyApi.default.waitMachine(this.id, { state: "stopped" });
    }

    await FlyApi.default.startMachine(this.id);
  }

  async stop() {
    //
    await this._refresh();

    if (this._machine.state === "stopped") {
      return;
    }

    if (this._machine.state === "destroyed") {
      throw new Error("Machine was destroyed");
    }

    if (this._machine.state === "created") {
      throw new Error("Machine was never started");
    }

    await FlyApi.default.stopMachine(this.id);
  }
}
