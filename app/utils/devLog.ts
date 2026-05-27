/**
 * Development-only logger.
 *
 * Calls are no-ops when `NODE_ENV === 'production'`. Use this for
 * diagnostic logs in modules that handle credentials, registry traffic,
 * or other paths where verbose production logging would leak sensitive
 * details into hosting platform logs.
 *
 * `console.warn` / `console.error` should be used directly for
 * conditions that are still useful to surface in production.
 */

const isDev = process.env.NODE_ENV !== 'production';

export const devLog = (...args: unknown[]): void => {
  if (isDev) console.log(...args);
};

export const devInfo = (...args: unknown[]): void => {
  if (isDev) console.info(...args);
};

export const devDebug = (...args: unknown[]): void => {
  if (isDev) console.debug(...args);
};
