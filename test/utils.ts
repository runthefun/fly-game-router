export function randomDelay(min: number, max: number) {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDeferred() {
  //
  let resolve, reject;
  let promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });

  return { promise, resolve, reject };
}

// check condition on each node event tick
export async function waitCondition(
  condition: () => boolean,
  timeout = 10 * 1000
) {
  //
  return new Promise((resolve, reject) => {
    //
    const iid = setInterval(() => {
      if (condition()) {
        clearInterval(iid);
        clearTimeout(tid);
        resolve(null);
      }
    }, 1);

    const tid = setTimeout(() => {
      clearInterval(iid);
      reject(new Error("timeout"));
    }, timeout);
  });
}

export function randomId() {
  return Math.random().toString(36).substr(2, 9);
}
