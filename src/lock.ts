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
    ttlAfter: number,
    reason?: string
  ) {
    //

    if (!this.acquire(resourceId, 0, reason)) {
      throw new Error("Resource is already locked " + resourceId);
    }

    const promise = task();

    promise.finally(() => {
      setTimeout(() => {
        this.release(resourceId, reason);
      }, ttlAfter);
    });

    return promise;
  }

  acquire(resourceId: string, ttl = this._maxTTl, reason = null): boolean {
    //
    // if (!reason) {
    //   console.trace("reason is required");
    // }
    if (this.isLocked(resourceId)) {
      return false;
    }

    if (this._log) {
      console.log("lock.acquire", resourceId, reason ? `(${reason})` : "");
    }

    this.locks.set(resourceId, {
      acquiredAt: new Date(),
      timeout: setTimeout(() => {
        this.release(resourceId, reason);
      }, Math.min(ttl, this._maxTTl)),
    });

    return true;
  }

  release(resourceId: string, reason?: string): boolean {
    //
    // if (!reason) {
    //   console.trace("reason is required");
    // }
    const lock = this.locks.get(resourceId);

    if (!lock) return false;

    if (this._log) {
      console.log("lock.release", resourceId, reason ? `(${reason})` : "");
    }

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

  _unsafe_clear() {
    this.locks.clear();
  }
}
