import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeOff, Globe, MapPin } from "lucide-react";
import { Badge } from "@/components/badges";
import { Avatar, Callout, Card, Disclosure, buttonClass } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { getProfile } from "@/modules/community";
import { giveBack, listPosts } from "@/modules/community/showcase";
import { PostGrid } from "../../showcase/post-grid";
import { reportProfileAction } from "../../../(community)/community/actions";
import { OrganizerForm, ReportForm, UnhideForm } from "../../../(community)/community/forms";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await getProfile((await params).handle, await getSignedIn());
  return { title: found ? found.name : "Member" };
}

const LINKS = [
  ["websiteUrl", "Website"],
  ["githubUrl", "GitHub"],
  ["linkedinUrl", "LinkedIn"],
  ["xUrl", "X"],
] as const;

export default async function MemberPage({ params }: Params) {
  const viewer = await getSignedIn();
  const found = await getProfile((await params).handle, viewer);
  if (!found) notFound();
  const { profile: p, name, self, organizer } = found;
  const [counts, projects] = await Promise.all([giveBack(p.userId), listPosts(viewer, { authorId: p.userId })]);
  const links = LINKS.filter(([key]) => p[key]).map(([key, label]) => ({ url: p[key]!, label }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {p.hiddenAt && (
        <Callout tone="bad" icon={EyeOff}>
          This profile is hidden by the organizers{p.hiddenReason ? `: ${p.hiddenReason}` : "."} Only you{self ? "" : ", the member"} and the organizers can see it.
        </Callout>
      )}
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={name} />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              {p.headline && <p className="text-muted">{p.headline}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              {p.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" aria-hidden /> {p.city}
                </span>
              )}
              {p.communityRole === "ORGANIZER" && <Badge tone="violet">Organizer</Badge>}
              {p.reviewer && <Badge tone="green">Reviewer</Badge>}
              {p.wantsMentor && <Badge tone="amber">Looking for a mentor</Badge>}
              <span>
                {counts.posts} {counts.posts === 1 ? "project" : "projects"} · {counts.reviews} {counts.reviews === 1 ? "review" : "reviews"} given
              </span>
              <span>Member since {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Accra" }).format(p.createdAt)}</span>
            </div>
          </div>
          {self && (
            <Link href="/community/profile" className={buttonClass("secondary", "sm")}>
              Edit profile
            </Link>
          )}
        </div>
      </Card>

      {p.tools.length > 0 && (
        <Card title="Tools">
          <ul className="flex flex-wrap gap-2">
            {p.tools.map((t) => (
              <li key={t} className="rounded-full border border-line bg-surface-muted px-3 py-1 text-sm">
                {t}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {p.bio && (
        <Card title="About">
          <p className="whitespace-pre-line break-words text-sm">{p.bio}</p>
        </Card>
      )}

      {links.length > 0 && (
        <Card title="Links">
          <ul className="space-y-2 text-sm">
            {links.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <Globe className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="w-20 shrink-0 text-muted">{l.label}</span>
                <a href={l.url} target="_blank" rel="nofollow ugc noopener noreferrer" className="min-w-0 truncate font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {l.url.replace(/^https:\/\//, "")}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {projects.posts.length > 0 && (
        <Card title="Projects">
          <PostGrid posts={projects.posts} />
        </Card>
      )}

      {organizer && !self && (
        <Card title="Organizer tools">
          <div className="flex flex-wrap gap-3">
            {p.hiddenAt && <UnhideForm handle={p.handle} />}
            <OrganizerForm handle={p.handle} on={p.communityRole !== "ORGANIZER"} />
          </div>
        </Card>
      )}

      {viewer && !self && (
        <Disclosure summary="Report this profile">
          <ReportForm action={reportProfileAction.bind(null, p.handle)} />
        </Disclosure>
      )}
    </div>
  );
}
