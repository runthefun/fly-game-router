import assert from "assert";
import { BackgroundJob } from "../src/job";
import { delay, randomDelay, waitCondition } from "./utils";

describe("MachinesPool tests", () => {
  //
  let jobId = 0;
  let job: BackgroundJob;
  let counter = 0;

  beforeEach(() => {
    //
    counter = 0;
    job?.stop();

    let id = "job-" + jobId++;

    const task = async () => {
      await randomDelay(5, 10);
      if (id !== job.id) return;
      counter++;
      // console.log(id, "task(), counter: ", counter, "frames: ", job.frames);
    };

    job = new BackgroundJob({
      id,
      task,
      pollInterval: 30,
    });
  });

  it("should start and stop job", () => {
    //
    job.start();

    assert.ok(job.active);

    job.stop();

    assert.ok(!job.active);
  });

  it("should not start job if already started", () => {
    //
    job.start();

    assert.ok(job.active);

    job.start();

    assert.ok(job.active);
  });

  it("should not stop job if already stopped", () => {
    //
    job.start();

    assert.ok(job.active);

    job.stop();

    assert.ok(!job.active);

    job.stop();

    assert.ok(!job.active);
  });

  it("should process task", async () => {
    //
    job.start();

    await waitCondition(() => job.frames == 3);

    assert.equal(counter, job.frames);
  });

  it("should stop job on error", async () => {
    //
    job.start();
    job.maxErrors = 2;
    job["_muteErrors"] = true;
    job["_task"] = async () => {
      throw new Error("Test error on frame " + job.frames);
    };

    await waitCondition(() => job.errors == job.maxErrors);

    assert.ok(!job.active);
  });
});
