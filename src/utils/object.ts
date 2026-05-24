/**
 * Type-safe property-name accessor. Provides a string at runtime while letting TypeScript
 * verify the key exists on `T`. Replaces the legacy `Object.propertyOf<T>` static extension.
 */
export function propertyOf<T>(key: keyof T & string): string {
  return key;
}
