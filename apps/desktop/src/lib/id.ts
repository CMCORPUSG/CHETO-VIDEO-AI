export function createId(): string {
  return globalThis.crypto.randomUUID();
}
