import "server-only";
import { headers } from "next/headers";
import type { RequestMeta } from "@/modules/audit";

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
}
