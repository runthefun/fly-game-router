import { ENV } from "../src/env";
import { FlyApi } from "../src/FlyApi";
import { defaultConfig } from "../src/machine.config";
import { MachinesPool } from "../src/MachinesPool";
import { FlyMockApi } from "./FlyMockApi";

const MIN_POOL_SIZE = 5;
const MAX_POOL_SIZE = 15;
const POLL_INTERVAL = 5 * 60 * 1000;

export function createMockPool() {
  //
  FlyMockApi.resetAll();

  let srcAppApi = FlyMockApi.create("srcApp");

  srcAppApi._machinesDb.push(
    srcAppApi._mockCreateMachine({
      id: "mref",
      config: {
        ...defaultConfig,
        metadata: { ref: "mref" },
      },
      region: "lhr",
    })
  );

  let api = FlyMockApi.create("default");

  return new MachinesPool({
    poolId: "test-pool",
    minSize: MIN_POOL_SIZE,
    maxSize: MAX_POOL_SIZE,
    pollInterval: POLL_INTERVAL,
    api,
    templateApp: "srcApp",
    templateMachineId: "mref",
  });
}

export function createFlyPool() {
  //
  const api = new FlyApi({
    appId: "awe-test-server",
    apiKey: ENV.FLY_API_KEY!,
  });

  return new MachinesPool({
    poolId: "test-pool",
    minSize: MIN_POOL_SIZE,
    maxSize: MAX_POOL_SIZE,
    pollInterval: POLL_INTERVAL,
    api,
    templateApp: ENV.TEMPLATE_APP!,
    templateMachineId: ENV.TEMPLATE_MACHINE!,
  });
}
