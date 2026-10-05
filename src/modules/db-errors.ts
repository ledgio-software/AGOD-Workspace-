/** True when a (Drizzle-wrapped) PostgreSQL error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
  return code === "23505";
}
