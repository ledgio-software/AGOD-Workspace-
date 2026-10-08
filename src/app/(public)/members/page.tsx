import type { Metadata } from "next";
import Link from "next/link";
import { inputClass } from "@/components/input-class";
import { buttonClass } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { listMembers, memberCities } from "@/modules/community";
import { MemberGrid } from "./member-grid";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata("Members", "Meet the builders: developers, designers and AI builders across Ghana, with what they build and the tools they use.");

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; city?: string; reviewers?: string; page?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const filters = { q: params.q, city: params.city, reviewers: params.reviewers === "1", page };
  const [{ members, more }, cities] = await Promise.all([listMembers(viewer, filters), memberCities(viewer)]);
  const next = new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.city ? { city: params.city } : {}), ...(filters.reviewers ? { reviewers: "1" } : {}), page: String(page + 1) });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted">Builders, developers, students and founders across Ghana. Find a reviewer, a mentor or someone to build with.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-sm">
          <span className="font-medium">Search</span>
          <input name="q" defaultValue={params.q ?? ""} placeholder="Name, what they build, a tool…" className={inputClass} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">City</span>
          <select name="city" defaultValue={params.city ?? ""} className={inputClass}>
            <option value="">Anywhere</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="reviewers" value="1" defaultChecked={filters.reviewers} /> Reviewers only
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Search
        </button>
      </form>
      <MemberGrid members={members} />
      {more && (
        <Link href={`/members?${next}`} className={buttonClass("secondary", "sm")}>
          More members
        </Link>
      )}
      {!viewer && (
        <p className="text-sm text-muted">
          Some members show their profile to signed-in members only.{" "}
          {signupOpen() ? (
            <Link href="/sign-up" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Join the community
            </Link>
          ) : (
            <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Sign in
            </Link>
          )}{" "}
          to see everyone.
        </p>
      )}
    </div>
  );
}
