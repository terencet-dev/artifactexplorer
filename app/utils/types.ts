/**
 * Type utilities for better TypeScript usage
 */

/**
 * Safely type event handlers
 */
export type EventHandler<T extends Event = Event, R = void> = (event: T) => R;

/**
 * Type for components with children
 */
export interface WithChildren {
  children: React.ReactNode;
}

/**
 * Type for ensuring non-nullable values
 */
export type NonNullable<T> = T extends null | undefined ? never : T;

/**
 * Type for making certain properties required
 */
export type RequireProps<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> };

/**
 * Deep readonly utility type
 */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends Record<string, unknown>
    ? DeepReadonly<T[K]>
    : T[K] extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T[K];
}; 