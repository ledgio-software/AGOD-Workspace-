import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";
import { acceptConduct, ensureProfile, updateProfile } from "@/modules/community";
import { createSession } from "@/modules/community/sessions";
import { db } from "./fixtures";
vi.mock("server-only", () => ({}));
// Regression: the call link check once refused any link containing the letter "s" (an escaping slip).
it("a call link with the letter s is accepted", async () => {
  const id = randomUUID();
  const m = { id, name: "Host", email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  const p = await ensureProfile(m);
  await acceptConduct(m);
  await updateProfile(m, { handle: p.handle, headline: "", bio: "", city: "", tools: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", xUrl: "", reviewer: true, wantsMentor: false, visibility: "PUBLIC" });
  const s = await createSession(m, { title: "Debugging AI code", description: "How to debug code an AI wrote for you", level: "ALL", topics: "Debug AI-generated code", date: "2026-10-09", time: "18:00", durationMinutes: 120, callUrl: "https://meet.google.com/bpp-edbd-psb", capacity: "" });
  expect(s.callUrl).toBe("https://meet.google.com/bpp-edbd-psb");
});
