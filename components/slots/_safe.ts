export function safeArr<T>(x: ReadonlyArray<T> | null | undefined): ReadonlyArray<T> {
  return Array.isArray(x) ? x : [];
}
