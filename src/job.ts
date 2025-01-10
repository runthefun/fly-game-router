import { delay } from "./utils";

/**
 * An abstract class that periodically performs a task in the background.
 */
export class BackgroundJob {
  //
  private _id: string;
  private _active = false;
  private _pollInterval: number;
  private _task: () => Promise<unknown>;

  private _maxErrors = 0;
  private _errors = 0;
  private _frames = 0;

  constructor(opts: {
    id: string;
    task: () => Promise<unknown>;
    pollInterval: number;
    maxErrors?: number;
  }) {
    //
    this._id = opts.id;
    this._task = opts.task;
    this._pollInterval = opts.pollInterval;
    this._maxErrors = opts.maxErrors ?? 100;
  }

  get id() {
    return this._id;
  }

  get active() {
    return this._active;
  }

  get pollInterval() {
    return this._pollInterval;
  }

  set pollInterval(value) {
    this._pollInterval = value;
  }

  get maxErrors() {
    return this._maxErrors;
  }

  set maxErrors(value) {
    this._maxErrors = value;
  }

  get frames() {
    return this._frames;
  }

  get errors() {
    return this._errors;
  }

  start() {
    //
    if (this._active) {
      return;
    }

    this._active = true;

    this._startLoop();
  }

  stop() {
    //
    if (!this._active) {
      return;
    }

    this._active = false;
  }

  // used for testing
  private _muteErrors = false;

  private async _startLoop() {
    //
    // console.log("Starting job", this._id);
    this._frames = 0;
    this._errors = 0;

    try {
      while (this._active) {
        try {
          // console.log(this._id, "frame", this._frames);
          await this._process();

          this._errors = 0;
        } catch (e) {
          this._errors++;

          // mute console.error on TEST env
          if (!this._muteErrors) {
            console.error("Job #" + this.id, "Error processing", e);
          }

          if (this._errors >= this._maxErrors) {
            if (!this._muteErrors) {
              console.error(
                `Max errors ${this._maxErrors} reached stopping job`
              );
            }
            this.stop();
          }
        } finally {
          this._frames++;
        }

        await delay(this._pollInterval);
      }
    } finally {
      // console.log("Stopped job", this._id);
      this._frames = 0;
    }
  }

  private _isProcessing = false;

  private async _process() {
    //
    if (this._isProcessing) {
      console.warn("Already processing");
      return;
    }

    try {
      this._isProcessing = true;
      // console.log("Processing job", this._id, this._frames);
      await this._task();
    } finally {
      this._isProcessing = false;
    }
  }
}
