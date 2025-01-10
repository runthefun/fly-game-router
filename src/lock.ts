//
interface LockData {
  acquiredAt: Date;
  timeout?: NodeJS.Timeout;
}

const DEFAULT_TTL = 1000 * 30; // 30 seconds

export class ResourceLock<T> {
  //
  _log = false;

  private _maxTTl: number;
  private locks: Map<string, LockData> = new Map();

  constructor(opts?: { maxTtl?: number }) {
    this._maxTTl = opts?.maxTtl || DEFAULT_TTL;
  }

  tryWithLock(
    resourceId: string,
    task: () => Promise<unknown>,
    ttlAfter: number
  ) {
    //

    if (!this.acquire(resourceId)) {
      throw new Error("Resource is already locked " + resourceId);
    }

    const promise = task();

    promise.finally(() => {
      setTimeout(() => {
        this.release(resourceId);
      }, ttlAfter);
    });

    return promise;
  }

  acquire(resourceId: string, ttl = this._maxTTl): boolean {
    //
    if (this._log) {
      console.log(
        "lock.acquire",
        resourceId,
        "- cur: ",
        Array.from(this.locks.keys()).join(", ")
      );
    }

    if (this.isLocked(resourceId)) {
      return false;
    }

    this.locks.set(resourceId, {
      acquiredAt: new Date(),
      timeout: setTimeout(() => {
        this.release(resourceId);
      }, Math.min(ttl, this._maxTTl)),
    });

    return true;
  }

  release(resourceId: string): boolean {
    //
    if (this._log) {
      console.log(
        "lock.release",
        resourceId,
        "- cur: ",
        Array.from(this.locks.keys()).join(", ")
      );
    }

    const lock = this.locks.get(resourceId);

    if (!lock) return false;

    if (lock.timeout) clearTimeout(lock.timeout);
    this.locks.delete(resourceId);
    return true;
  }

  isLocked(resourceId: string): boolean {
    return this.locks.has(resourceId);
  }

  getLocks() {
    return Array.from(this.locks.keys());
  }
}
