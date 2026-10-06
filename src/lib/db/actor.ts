import { sql } from "drizzle-orm";
import type { Actor } from "@/lib/permissions";
import { db, type Tx } from "./index";

/**
 * Runs `fn` in a transaction as the restricted `agod_app` role, with the acting user set for
 * Postgres row-level security. Every domain read and write goes through this, so the database
 * enforces the same rules as the permission service even if application code has a bug.
 *
 * The policies look up the actor's role in their membership of the company (app.org_id), so
 * only the user id and company (both checked against the verified session) are trusted here;
 * every company-owned row is limited to that company.
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role agod_app`);
    await tx.execute(sql`select set_config('app.user_id', ${actor.id}, true), set_config('app.org_id', ${actor.orgId}, true)`);
    return fn(tx);
  });
}

/**
 * For system work without a signed-in person (the daily job, webhooks): a transaction on the
 * owner connection with the company set, so new rows belong to it and org_members lists its
 * people. Not limited by row-level security: callers filter by company themselves.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
