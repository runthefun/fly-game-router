import {
  CreateMachineOpts,
  CreateMachineOptsNoConfig,
  Machine,
  MachineConfig,
  MachineState,
} from "../src/types";
import { defaultConfig } from "../src/machine.config";
import { FlyApi } from "../src/FlyApi";
import { randomDelay } from "./utils";

/*

get /v1/apps/{app_name}/machines
post /v1/apps/{app_name}/machines
get /v1/apps/{app_name}/machines/{machine_id}/wait
get /v1/apps/{app_name}/machines/{machine_id}
post /v1/apps/{app_name}/machines/{machine_id}
post /v1/apps/{app_name}/machines/{machine_id}/stop

post /v1/apps/{app_name}/machines/{machine_id}/start
delete /v1/apps/{app_name}/machines/{machine_id}



post /v1/apps/{app_name}/machines/{machine_id}/cordon
post /v1/apps/{app_name}/machines/{machine_id}/uncordon

get /v1/apps/{app_name}/machines/{machine_id}/metadata
post /v1/apps/{app_name}/machines/{machine_id}/metadata/{key}
delete /v1/apps/{app_name}/machines/{machine_id}/metadata/{key}
*/

export class FlyMockApi extends FlyApi {
  //
  _autoInc = 0;
  _machinesDb: Machine[] = [];

  static _apisByApp: Record<string, FlyMockApi> = {};

  static create(appName: string) {
    if (this._apisByApp[appName] != null) {
      throw new Error(appName + "was already created");
    }
    this._apisByApp[appName] = new FlyMockApi(appName);
    return this._apisByApp[appName];
  }

  static getApi(appName: string) {
    if (!this._apisByApp[appName]) {
      throw new Error(appName + "was not created");
    }
    return this._apisByApp[appName];
  }

  static resetAll() {
    this._apisByApp = {};
  }

  constructor(public _app: string) {
    super({} as any);
  }

  _isDestroyed(m: Machine) {
    return m.state === "destroyed" || m.state === "destroying";
  }

  _getMachines() {
    return this._machinesDb.filter((m) => !this._isDestroyed(m));
  }

  _findMachine(machineId: string) {
    return this._getMachines().find((m) => m.id === machineId);
  }

  _findMachineIndex(machineId: string) {
    return this._getMachines().findIndex((m) => m.id === machineId);
  }

  _loggedMachines = new Set<string>();

  _logTransitions(mid: string, b: boolean) {
    if (b) {
      this._loggedMachines.add(mid);
    } else {
      this._loggedMachines.delete(mid);
    }
  }

  _stateCbs = new Set<(m: Machine) => void>();

  _onState(cb: (m: Machine) => void) {
    this._stateCbs.add(cb);
    return () => {
      this._stateCbs.delete(cb);
    };
  }

  _transition(
    m: Machine,
    event:
      | `init-${"start" | "stop"}`
      | `${"begin" | "end"}-replace`
      | `${"begin" | "end"}-${"start" | "stop" | "suspend" | "destroy"}`
  ) {
    //
    const _assertState = (state: MachineState) => {
      if (m.state !== state) {
        throw new Error(
          `${m.id}: Invalid transition ${m.state}:${event}. Expected ${state}`
        );
      }
    };

    const startState = m.state;

    switch (event) {
      case "init-start":
        _assertState("created");
        m.state = "started";
        break;
      case "init-stop":
        _assertState("created");
        m.state = "stopped";
        break;
      case "begin-start":
        _assertState("stopped");
        m.state = "starting";
        break;
      case "end-start":
        _assertState("starting");
        m.state = "started";
        break;
      case "begin-stop":
        _assertState("started");
        m.state = "stopping";
        break;
      case "end-stop":
        _assertState("stopping");
        m.state = "stopped";
        break;
      case "begin-suspend":
        _assertState("started");
        m.state = "suspending";
        break;
      case "end-suspend":
        _assertState("suspending");
        m.state = "suspended";
        break;
      case "begin-destroy":
        if (m.state != "destroyed" && m.state != "destroying") {
          m.state = "destroying";
        } else {
          throw new Error("Invalid transition " + m.state);
        }
        break;
      case "end-destroy":
        _assertState("destroying");
        m.state = "destroyed";
        break;
      case "begin-replace":
        if (m.state !== "destroyed" && m.state !== "destroying") {
          m.state = "replacing";
        } else {
          throw new Error("Invalid transition " + m.state);
        }
        break;
      case "end-replace":
        _assertState("replacing");
        m.state = "created";
        break;
      default:
        const _: never = event;
        throw new Error("Invalid transition " + m.state + " : " + event);
    }

    if (this._loggedMachines.has(m.id)) {
      console.log(`${m.id}-${startState} -(${event})-> ${m.state}`);
    }

    this._stateCbs.forEach((cb) => {
      cb(m);
    });
  }

  _maxFailureCount = 0;
  _failureCount = 0;

  setMaxFailureCount(count: number) {
    this._maxFailureCount = count;
  }

  _dumpMachines() {
    console.log("Machines :");
    console.log("--------------------------------");
    this._getMachines().forEach((m) => {
      console.log(
        m.id,
        " ".repeat(5),
        m.state,
        " ".repeat(5),
        JSON.stringify(m.config.metadata)
      );
    });
    console.log("--------------------------------");
  }

  resetFailureCount() {
    this._failureCount = 0;
  }

  reset() {
    this._machinesDb = [];
    this._autoInc = 0;
    this.resetFailureCount();
    this._maxFailureCount = 0;
    this._loggedMachines.clear();
  }

  networkDelay() {
    return randomDelay(10, 50);
  }

  provisionMachineDelay() {
    return randomDelay(100, 200);
  }

  transitionDelay() {
    return randomDelay(10, 20);
  }

  async getMachines(
    opts: {
      region?: string;
      metadata?: Record<string, string>;
      summary?: boolean;
    } = {}
  ): Promise<Machine[]> {
    //
    await this.networkDelay();

    let results = structuredClone(this._getMachines());

    if (opts.metadata != null) {
      for (const key in opts.metadata) {
        results = results.filter(
          (m) => m.config.metadata[key] === (opts as any).metadata[key]
        );
      }
    }

    await this.networkDelay();

    return structuredClone(results);
  }

  _mockCreateMachine(data: Partial<Machine>): Machine {
    //
    const { config, ...rest } = data;

    const mergedConfig: MachineConfig = {
      ...defaultConfig,
      ...(config || {}),
    };

    return structuredClone({
      config: mergedConfig,
      id: "m-" + this._autoInc++,
      name: "mock-" + Math.random().toString(),
      state: "created",
      instance_id: "i" + Math.random(),
      ...data,
    }) as any;
  }

  async createMachine(
    opts: CreateMachineOpts,
    waitStart = false
  ): Promise<Machine> {
    //
    await this.networkDelay();

    if (waitStart && opts.skip_launch) {
      throw new Error("skip_launch and waitStart are mutually exclusive");
    }

    if (this._maxFailureCount && this._failureCount < this._maxFailureCount) {
      this._failureCount++;
      throw new Error("Mock Network error", { cause: "api-mock" });
    }

    await this.provisionMachineDelay();

    const res = await this._mockCreateMachine({
      config: opts.config,
    });

    this._machinesDb.push(res);

    if (opts.skip_launch) {
      //
      this.transitionDelay().then(() => {
        this._transition(res, "init-stop");
      });
    } else {
      this.transitionDelay().then(() => {
        this._transition(res, "init-start");
      });
    }

    if (waitStart) {
      await this.waitMachine(res.id, { state: "started" });
    }
    return structuredClone(res);
  }

  async updateMachine(
    machineId: string,
    opts: CreateMachineOpts
  ): Promise<Machine> {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      throw new Error("Machine not found");
    }

    this._transition(machine, "begin-replace");

    this.provisionMachineDelay().then(() => {
      this._transition(machine, "end-replace");
      machine.config = opts.config;
    });

    return structuredClone(machine);
  }

  async deleteMachine(
    machineId: string,
    opts?: {
      force?: boolean;
    }
  ) {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    // console.log("deleteMachine", machine.state, opts);

    if (machine.state === "started" || machine.state === "starting") {
      if (!opts?.force) {
        throw new Error("Machine is started and force is not set");
      }
    }

    this._transition(machine, "begin-destroy");

    this.transitionDelay().then(() => {
      //
      this._transition(machine, "end-destroy");
    });
  }

  async cloneMachine(
    app: string,
    machineId: string,
    onOpts: (machineData: Machine) => CreateMachineOpts,
    waitStart = false
  ): Promise<Machine> {
    //
    await this.networkDelay();

    const machineData = await this.getMachine(machineId, app);

    const opts = onOpts(machineData);

    return this.createMachine(opts, waitStart);
  }

  async waitMachine(
    machineId: string,
    opts: {
      state: MachineState;
      timeout?: number;
      instance_id?: string;
    }
  ) {
    await this.networkDelay();

    if (opts.state === "stopped" && !opts.instance_id) {
      throw new Error("instance_id is required when waiting for stopped state");
    }

    const machine = this._machinesDb.find((m) => m.id === machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found " + machineId));
    }

    if (machine.state === opts.state) {
      return;
    }

    const start = Date.now();
    // listen to state changes
    return new Promise<void>((resolve, reject) => {
      //
      let machine = this._machinesDb.find((m) => m.id === machineId);

      if (!machine) {
        reject(new Error("Machine not found"));
        return;
      }

      if (machine.state === opts.state) {
        resolve();
        return;
      }

      let timeout: NodeJS.Timeout;

      const cb = (m: Machine) => {
        if (m.id === machineId && m.state === opts.state) {
          this._stateCbs.delete(cb);
          clearTimeout(timeout);
          resolve();
        }
      };

      this._stateCbs.add(cb);

      if (opts.timeout != null) {
        timeout = setTimeout(() => {
          this._stateCbs.delete(cb);
          reject(new Error("Timeout"));
        }, opts.timeout);
      }
    });
  }

  async getMachine(machineId: string, app = this._app): Promise<Machine> {
    //
    if (app !== this._app) {
      //
      return FlyMockApi.getApi(app).getMachine(machineId);
    }

    await this.networkDelay();

    const machine = this._machinesDb.find((m) => m.id === machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    return structuredClone(machine);
  }

  async stopMachine(machineId: string, waitStop = false) {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    this._transition(machine, "begin-stop");

    this.transitionDelay().then(async () => {
      this._transition(machine, "end-stop");
      if (machine.config.auto_destroy) {
        await this.transitionDelay();
        this._transition(machine, "begin-destroy");
        await this.transitionDelay();
        this._transition(machine, "end-destroy");
      }
    });

    if (waitStop) {
      const machine = await this.getMachine(machineId);
      await this.waitMachine(machineId, {
        state: "stopped",
        instance_id: machine.instance_id,
      });
    }
  }

  async suspendMachine(machineId: string) {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    this._transition(machine, "begin-suspend");
    this.transitionDelay().then(() => {
      this._transition(machine, "end-suspend");
    });
  }

  async startMachine(
    machineId: string,
    waitState = true,
    logger?: (...args: string[]) => void
  ) {
    //
    logger?.("wait network", machineId);
    await this.networkDelay();
    logger?.("wait network done", machineId);

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    this._transition(machine, "begin-start");

    this.transitionDelay().then(() => {
      this._transition(machine, "end-start");
    });

    if (waitState) {
      logger?.("wait start state", machineId);
      await this.waitMachine(machineId, { state: "started" });
      logger?.("wait start state done", machineId);
    }
  }

  async getMachineMetadata(machineId: string) {
    //
    await this.networkDelay();

    const machine = this._machinesDb.find((m) => m.id === machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    return machine.config.metadata;
  }

  async updateMachineMetadata(machineId: string, key: string, value: string) {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    machine.config.metadata[key] = value;
  }

  async deleteMachineMetadata(machineId: string, key: string) {
    //
    await this.networkDelay();

    const machine = this._findMachine(machineId);

    if (!machine) {
      return Promise.reject(new Error("Machine not found"));
    }

    delete machine.config.metadata[key];
  }
}
