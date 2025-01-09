import "dotenv/config";
import {
  CreateMachineOpts,
  CreateMachineOptsNoConfig,
  Machine,
  MachineConfig,
  MachineState,
} from "./types";
import { delay } from "./utils";

const flyApp = process.env.FLY_APP_NAME;

const FLY_PUBLIC_URL = "https://api.machines.dev";
const FLY_INTERNAL_URL = "http://_api.internal:4280";
const FLY_BASE_URL = flyApp ? FLY_INTERNAL_URL : FLY_PUBLIC_URL;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, opts) => fetch(url, opts);

export class FlyApi {
  apiKey: string;
  appId: string;
  headers: Record<string, string>;
  fetcher: Fetcher;

  constructor(opts: { apiKey: string; appId: string; fetcher?: Fetcher }) {
    //
    this.apiKey = opts.apiKey;
    this.appId = opts.appId;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    this.fetcher = opts.fetcher ?? defaultFetcher;
    // console.log("FlyApi created", this.apiKey, this.appId);
  }

  protected async _query({ method, url, params = {}, body = null }) {
    //
    let searchParams = new URLSearchParams();

    if (params) {
      for (const key in params) {
        searchParams.append(key, params[key]);
      }

      let queryString = searchParams.toString();

      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const resp = await fetch(`${FLY_BASE_URL}${url}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : null,
    });

    const log = `${method} ${url}: ${resp.status}-${resp.statusText}`;
    // console.log(log);

    if (!resp.ok) {
      if (resp.status === 408) {
        throw new Error("timeout");
      }

      const text = await resp.text();
      throw new Error(`${log} - ${text}`);
    }

    return resp.json().catch((e) => {
      return null;
    });
  }

  get(url: string, params?: Record<string, any>) {
    return this._query({
      method: "GET",
      url,
      params,
    });
  }

  post(url: string, body?: any) {
    return this._query({
      method: "POST",
      url,
      body,
    });
  }

  delete(url: string, params?: Record<string, any>) {
    return this._query({
      method: "DELETE",
      url,
      params,
    });
  }

  getMachines(
    opts: {
      region?: string;
      metadata?: Record<string, string>;
      summary?: boolean;
    } = {}
  ): Promise<Machine[]> {
    //
    let { metadata, ...params } = opts;

    if (metadata) {
      for (const key in metadata) {
        params[`metadata.${key}`] = metadata[key];
      }
    }

    return this.get(`/v1/apps/${this.appId}/machines`, params);
  }

  getMachinesByMetadata(metadata: Record<string, string>) {
    return this.getMachines({ metadata });
  }

  updateMachineMetadata(machineId: string, key: string, value: string) {
    //
    return this.post(
      `/v1/apps/${this.appId}/machines/${machineId}/metadata/${key}`,
      {
        value,
      }
    );
  }

  deleteMachineMetadata(machineId: string, key: string) {
    return this.delete(
      `/v1/apps/${this.appId}/machines/${machineId}/metadata/${key}`
    );
  }

  async createMachine(
    opts: CreateMachineOpts,
    waitStart = false
  ): Promise<Machine> {
    //
    if (waitStart && opts.skip_launch) {
      throw new Error("skip_launch and waitStart are mutually exclusive");
    }

    const res = await this.post(`/v1/apps/${this.appId}/machines`, opts);
    if (waitStart) {
      await this.waitMachine(res.id, { state: "started" });
    }
    return res;
  }

  async updateMachine(
    machineId: string,
    opts: CreateMachineOpts
  ): Promise<Machine> {
    const res = await this.post(
      `/v1/apps/${this.appId}/machines/${machineId}`,
      opts
    );
    return res;
  }

  deleteMachine(
    machineId: string,
    opts?: {
      force?: boolean;
    }
  ) {
    return this.delete(`/v1/apps/${this.appId}/machines/${machineId}`, opts);
  }

  async waitMachine(
    machineId: string,
    opts: {
      state: MachineState;
      timeout?: number;
      instance_id?: string;
    }
  ) {
    if (opts.state === "stopped" && !opts.instance_id) {
      throw new Error("instance_id is required when waiting for stopped state");
    }

    const url = `/v1/apps/${this.appId}/machines/${machineId}/wait`;

    for (let i = 0; i < 5; i++) {
      try {
        await this.get(url, opts);
        return;
      } catch (e) {
        //
        if (e.message === "timeout") {
          console.error(
            "timeout waiting for machine",
            machineId,
            "to reach state",
            opts.state,
            "retrying after 1s"
          );

          await delay(1000);
        }
      }
    }
  }

  getMachine(machineId: string, app = this.appId): Promise<Machine> {
    return this.get(`/v1/apps/${app}/machines/${machineId}`);
  }

  async cloneMachine(
    app: string,
    machineId: string,
    onOpts: (machineData: Machine) => CreateMachineOpts,
    waitStart = false
  ): Promise<Machine> {
    //
    const machineData = await this.getMachine(machineId, app);

    const opts = onOpts(machineData);

    return this.createMachine(opts, waitStart);
  }

  async stopMachine(machineId: string, waitStop = false) {
    await this.post(`/v1/apps/${this.appId}/machines/${machineId}/stop`);
    if (waitStop) {
      const machine = await this.getMachine(machineId);
      await this.waitMachine(machineId, {
        state: "stopped",
        instance_id: machine.instance_id,
      });
    }
  }

  suspendMachine(machineId: string) {
    return this.post(`/v1/apps/${this.appId}/machines/${machineId}/suspend`);
  }

  async startMachine(machineId: string, waitState = true) {
    await this.post(`/v1/apps/${this.appId}/machines/${machineId}/start`);
    if (waitState) {
      await this.waitMachine(machineId, { state: "started" });
    }
  }

  disableMachine(machineId: string) {
    return this.post(`/v1/apps/${this.appId}/machines/${machineId}/cordon`);
  }

  enableMachine(machineId: string) {
    return this.post(`/v1/apps/${this.appId}/machines/${machineId}/uncordon`);
  }

  getMachineMetadata(machineId: string) {
    return this.get(`/v1/apps/${this.appId}/machines/${machineId}/metadata`);
  }

  async destroyAll() {
    const machines = await this.getMachines();
    await Promise.all(machines.map((m) => this.deleteMachine(m.id)));
  }
}
