"use server";

import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { ServiceError } from "@/modules/errors";
import { overLimit, submitAccountAppeal } from "@/modules/safety/appeals";
import { networkKey } from "@/modules/safety/links";

export async function appealLoginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { ip } = await getRequestMeta();
    if (ip && (await overLimit(`appeal:${networkKey(ip)}`, 5, 60 * 60_000))) throw new ServiceError("Too many appeals from here. Try again in an hour.");
    await submitAccountAppeal({ email: String(form.get("email") ?? ""), message: String(form.get("message") ?? "") });
    return undefined;
  }, "Thanks. If that email belongs to a blocked login, AGOD staff will look at your appeal and email you their decision.");
}
