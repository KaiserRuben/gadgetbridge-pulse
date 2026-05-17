/** Milliseconds since epoch (or duration in ms). */
export type Ms = number & { readonly __brand: "Ms" };
/** Seconds since epoch (or duration in s). */
export type Sec = number & { readonly __brand: "Sec" };
/** Promote a raw number to Ms (use only at data boundary). */
export const asMs = (n: number): Ms => n as Ms;
/** Promote a raw number to Sec (use only at data boundary). */
export const asSec = (n: number): Sec => n as Sec;
/** Convert ms to sec (truncates). */
export const msToSec = (ms: Ms): Sec => Math.floor((ms as number) / 1000) as Sec;
/** Convert sec to ms. */
export const secToMs = (s: Sec): Ms => ((s as number) * 1000) as Ms;
