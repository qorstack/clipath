export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Merge a patch into a settings object without losing sibling keys.
 *
 * Settings are written back whole, so a shallow merge of `{general: {theme}}`
 * would drop every other field in `general`. Arrays are replaced rather than
 * merged — none of the settings arrays are meant to accumulate.
 */
export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(patch as any)) {
    const value = (patch as any)[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
