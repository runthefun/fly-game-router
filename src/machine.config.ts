import { MachineConfig } from "./types";

export const defaultConfig: MachineConfig = {
  env: { FLY_PROCESS_GROUP: "app", PRIMARY_REGION: "mad" },
  init: {},
  guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
  metadata: {
    // fly_flyctl_version: "0.3.53",
    // fly_platform_version: "v2",
    // fly_process_group: "app",
    // fly_release_id: "wkDoezBKKpMDguQnV77OYqza",
    // fly_release_version: "4",
  },
  services: [
    {
      protocol: "tcp",
      internal_port: 2567,
      autostop: true,
      autostart: true,
      min_machines_running: 0,
      ports: [
        { port: 80, handlers: ["http"], force_https: true },
        { port: 443, handlers: ["http", "tls"] },
      ],
      force_instance_key: null,
    },
  ],
  image: "registry.fly.io/game-server-v2:deployment-01JFWYG77785Z7PT4YBXGG5WKR",
  restart: { policy: "on-failure", max_retries: 10 },
  auto_destroy: false,
};
