/**
 * Error handling utilities
 */

/**
 * Custom application error with additional context
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string = 'APP_ERROR', context?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Format error for logging
 */
export function formatError(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.name} (${error.code}): ${error.message}${
      error.context ? ` | Context: ${JSON.stringify(error.context)}` : ''
    }`;
  }
  
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  
  return String(error);
}

/**
 * Safely log errors
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  console.error(formatError(error), context || {});
}