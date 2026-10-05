/** An expected failure whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Database guard triggers raise check_violation / insufficient_privilege with a safe message. */
export function rethrowDbGuard(error: unknown): never {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "23514" || cause?.code === "42501") throw new ServiceError(cause.message ?? "Not allowed.");
  throw error;
}
