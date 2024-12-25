export function randomDelay(min: number, max: number) {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
