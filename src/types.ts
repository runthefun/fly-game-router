export type MachineState =
  | "created"
  // start
  | "starting"
  | "started"
  // stop
  | "stopping"
  | "stopped"
  // suspend
  | "suspending"
  | "suspended"
  // destroy
  | "destroying"
  | "destroyed"
  // update
  | "replacing";

export interface MachineConfigInit {
  cmd?: string[];
  entrypoint?: string[];
  exec?: string[];
  kernel_args?: string[];
  swap_size_mb?: number;
  tty?: boolean;
}

export interface MachineGuest {
  cpu_kind: string;
  cpus: number;
  gpu_kind?: string;
  gpus?: number;
  memory_mb: number;
}

export type MachineRestartPolicy =
  | "no"
  | "always"
  | "on-failure"
  | "spot-price";

export interface MachineConfig {
  env: Record<string, any>;
  init: MachineConfigInit;
  guest: MachineGuest;
  metadata: Record<string, string>;
  services: any[];
  image: string;
  auto_destroy: boolean;
  restart: { policy: MachineRestartPolicy; max_retries: number };
}

export interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
  digest: string;
  labels: any;
}

export interface Machine {
  id: string;
  name: string;
  state: MachineState;
  region: string;
  instance_id: string;
  config: MachineConfig;
  image_ref: ImageRef;
  created_at: string;
  updated_at: string;
  host_status: string;
}

export interface CreateMachineOpts {
  config: MachineConfig;
  name?: string;
  region?: string;
  skip_launch?: boolean;
}

export interface CreateMachineOptsNoConfig {
  name?: string;
  region?: string;
  skip_launch?: boolean;
}

export interface JoinReqBody {
  gameId: string;
  userId: string;
  username: string;
}

export interface Logger {
  log(...args: any[]): void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export const defaultLogger = console satisfies Logger;
