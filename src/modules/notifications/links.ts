/** Where a notification leads in the app, by what it is about. */
export function notificationPath(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  if (entityType === "project") return `/projects/${entityId}`;
  if (entityType === "subscription") return `/subscriptions/${entityId}`;
  if (entityType === "payout") return `/payouts/${entityId}`;
  if (entityType === "invoice") return `/invoices/${entityId}`;
  return null;
}
