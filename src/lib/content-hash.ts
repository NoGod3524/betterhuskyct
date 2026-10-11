/**
 * A short fingerprint of some text (FNV-1a, 32 bits, as hex): enough to tell whether a thing has
 * changed since it was last read, not to tell two different things apart for certain.
 */
export function contentHash(value: string): string {
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return (accumulator >>> 0).toString(16).padStart(8, "0");
}
