import assert from "assert";
import { FlyMockApi } from "./FlyMoackApi";
import { defaultConfig } from "../src/machine.config";
import { MachineState } from "../src/types";
import { FlyApi } from "../src/FlyApi";
import { randomDelay } from "./utils";

let api = new FlyMockApi();
FlyApi._instance = api;

describe("Api mock unit tests", () => {
  beforeEach(() => {
    api.reset();
  });

  afterEach(() => {
    //
  });

  const assertOneMachine = (machine, expectedState?: MachineState) => {
    //
    let machines = api._getMachines();
    assert.equal(machines.length, 1, "Machines should have one machine");
    assert.equal(machines[0].id, machine.id, "Machine should be the same");

    if (expectedState) {
      assert.equal(
        machines[0].state,
        expectedState,
        "Machine should be in state " + expectedState
      );
    }
  };

  it("should start with an empty list of machines", async () => {
    //
    let machines = await api.getMachines();

    assert.equal(machines.length, 0, "Machines should be empty");
  });

  it("should create a machine without starting it", async () => {
    //
    let machine = await api.createMachine({
      config: defaultConfig,
      skip_launch: true,
    });

    assert(machine.state === "created", "Machine should be created");

    assertOneMachine(machine);

    await api.waitMachine(machine.id, {
      state: "stopped",
      instance_id: machine.instance_id,
    });

    assert.equal(
      api._findMachine(machine.id)?.state,
      "stopped",
      "Machine should eventually reach stopped state"
    );
  });

  it("should create a machine and start it", async () => {
    //
    let machine = await api.createMachine({
      config: defaultConfig,
    });

    assert(machine.state === "created", "Machine should be created");

    await api.waitMachine(machine.id, { state: "started" });

    assertOneMachine(machine, "started");
  });

  it("should create a machine and start it with waitStart", async () => {
    //
    let machine = await api.createMachine(
      {
        config: defaultConfig,
      },
      true
    );
    assert(machine.state === "started", "Machine should be started");
    assertOneMachine(machine, "started");
  });

  it("should delete a machine", async () => {
    //
    let machine = await api.createMachine({
      config: defaultConfig,
      skip_launch: true,
    });

    assertOneMachine(machine);

    await api.deleteMachine(machine.id);

    let machines = await api.getMachines();
    assert.equal(machines.length, 0, "Machines should be empty");
  });

  it("should throw when we delete a started machine without force", async () => {
    //
    let machine = await api.createMachine(
      {
        config: defaultConfig,
      },
      true
    );

    assertOneMachine(machine, "started");

    await api.deleteMachine(machine.id).then(
      () => {
        assert.fail("Should throw an error");
      },
      (e) => {
        // console.error(e);
        assertOneMachine(machine, "started");
      }
    );
  });

  it("should delete a started machine with force", async () => {
    //
    let machine = await api.createMachine(
      {
        config: defaultConfig,
      },
      true
    );

    assertOneMachine(machine, "started");

    await api.deleteMachine(machine.id, { force: true });

    let machines = await api.getMachines();
    assert.equal(machines.length, 0, "Machines should be empty");
  });

  // TODO
  it("should update a machine");

  it("should stop a machine", async () => {
    //
    let machine = await api.createMachine(
      {
        config: defaultConfig,
      },
      true
    );

    assertOneMachine(machine, "started");

    await api.stopMachine(machine.id);
    await api.waitMachine(machine.id, {
      state: "stopped",
      instance_id: machine.instance_id,
    });
    assertOneMachine(machine, "stopped");
  });

  it("should get a machine", async () => {
    //
    let machine = await api.createMachine({
      config: defaultConfig,
    });

    let machine2 = await api.getMachine(machine.id);

    assert.equal(machine.id, machine2.id, "Machine should be the same");
  });

  it("should get a machine by metadata", async () => {
    //
    let machine = await api.createMachine({
      config: {
        ...defaultConfig,
        metadata: {
          roomId: "123",
        },
      },
    });

    let machines = await api.getMachinesByMetadata({ roomId: "123" });

    assert.equal(machines.length, 1, "Should have one machine");
    assert.equal(machines[0].id, machine.id, "Machine should be the same");
  });

  it("should update a machine's metadata key", async () => {
    //
    let machine = await api.createMachine({
      config: {
        ...defaultConfig,
        metadata: {
          roomId: "123",
        },
      },
    });

    await api.updateMachineMetadata(machine.id, "roomId", "456");

    let machine2 = await api.getMachine(machine.id);

    assert.equal(
      machine2.config.metadata.roomId,
      "456",
      "Metadata should be updated"
    );
  });

  it("should delete a machine's metadata key", async () => {
    //
    let machine = await api.createMachine({
      config: {
        ...defaultConfig,
        metadata: {
          roomId: "123",
        },
      },
    });

    await api.deleteMachineMetadata(machine.id, "roomId");

    let machine2 = await api.getMachine(machine.id);

    assert.equal(
      machine2.config.metadata.roomId,
      undefined,
      "Metadata should be deleted"
    );
  });
});

it("should clone a machine", async () => {
  //
  let machine = await api.createMachine({
    config: {
      ...defaultConfig,
      metadata: {
        ref: "123",
      },
    },
  });

  let machine2 = await api.cloneMachine(machine.id, (m) => ({
    config: m.config,
    skip_launch: true,
  }));

  assert.equal(
    machine2.config.metadata.ref,
    "123",
    "Metadata should be cloned"
  );
});

describe("Api mock, test with multiple machines", () => {
  //
  let machines = [];

  before(async () => {
    //
    api.reset();

    // create a number of machines
    let machines = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        randomDelay(0, 200).then(() =>
          api.createMachine({
            config: defaultConfig,
            skip_launch: true,
          })
        )
      )
    );
  });

  it("should all reach the stopped state eventually", async () => {
    //

    //
    const machines = await api.getMachines();

    await Promise.all(
      machines.map((m) =>
        api.waitMachine(m.id, {
          state: "stopped",
          timeout: 3000,
          instance_id: m.instance_id,
        })
      )
    );
  });

  it("should start all machines", async () => {
    // start all the machines
    let machines = await api.getMachines();

    await Promise.all(
      machines.map((m) =>
        randomDelay(0, 200).then(() => api.startMachine(m.id))
      )
    );

    // they all should reach the started state eventually
    await Promise.all(
      machines.map((m) =>
        api.waitMachine(m.id, { state: "started", timeout: 3000 })
      )
    );
  });

  it("delete one random machine", async () => {
    //
    let machines = await api.getMachines();

    let machine = machines[Math.floor(Math.random() * machines.length)];

    await api.deleteMachine(machine.id, { force: true });

    // the machine should be deleted
    machines = await api.getMachines();
    assert.equal(machines.length, 4, "Should have 4 machines");
  });

  it("stop one random machine", async () => {
    //
    let machines = await api.getMachines();

    let machine = machines[Math.floor(Math.random() * machines.length)];
    await api.stopMachine(machine.id);

    // the machine should be stopped
    await api.waitMachine(machine.id, {
      state: "stopped",
      instance_id: machine.instance_id,
    });

    machine = await api.getMachine(machine.id);
    assert.equal(machine.state, "stopped", "Machine should be stopped");
  });

  it("delete all machines", async () => {
    let machines = await api.getMachines();

    // delete all machines
    await Promise.all(
      machines.map((m) => api.deleteMachine(m.id, { force: true }))
    );

    machines = await api.getMachines();
    assert.equal(machines.length, 0, "Should have no machines");
  });
});
