import { sql } from "drizzle-orm";
import type { Actor } from "@/lib/permissions";
import { db, type Tx } from "./index";

/**
 * Runs `fn` in a transaction as the restricted `agod_app` role, with the acting user set for
 * Postgres row-level security. Every domain read and write goes through this, so the database
 * enforces the same rules as the permission service even if application code has a bug.
 *
 * The policies look up the actor's role and active flag in `users` by id, so only the user id
 * (taken from the verified session) is trusted here.
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role agod_app`);
    await tx.execute(sql`select set_config('app.user_id', ${actor.id}, true)`);
    return fn(tx);
  });
}
