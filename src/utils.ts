import { MachineConfig } from "./types";

function mergeConfig2(
  a: MachineConfig,
  b: Partial<MachineConfig>
): MachineConfig {
  //
  b ??= {};

  const r: MachineConfig = {
    ...a,
    guest: mergeRecords(a.guest, b.guest),
    env: mergeRecords(a.env, b.env),
    auto_destroy: b.auto_destroy ?? a.auto_destroy,
    image: b.image || a.image,
    metadata: mergeRecords(a.metadata, b.metadata),
    restart: b.restart || a.restart,
  };

  return r;
}

export function mergeConfigs(
  a: MachineConfig,
  ...cs: Partial<MachineConfig>[]
) {
  return cs.reduce<MachineConfig>((acc, c) => mergeConfig2(acc, c), a);
}

function mergeRecords(
  a: Record<string, any> | undefined,
  b: Record<string, any> | undefined
) {
  return {
    ...(a ?? {}),
    ...(b ?? {}),
  } as any;
}

export function randomDelay(min: number, max: number) {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function after(promise: Promise<any>, ms: number) {
  await promise;
  await delay(ms);
}

export function precondition(condition: any, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
