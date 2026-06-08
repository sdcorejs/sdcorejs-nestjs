/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Reference to any class — concrete OR abstract — used by metadata helpers that accept an
 * entity class as target. `Reflect.getMetadata` ultimately treats this as an object, but
 * `Function` is banned by the ESLint config so we declare the shape explicitly.
 */
export type ClassRef = abstract new (...args: any[]) => any;
