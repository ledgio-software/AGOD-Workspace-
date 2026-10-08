import Link from "next/link";
import { ArrowRight, Briefcase, GraduationCap, MessageSquareHeart, Rocket } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { communityStats, listMembers } from "@/modules/community";
import { listSessions } from "@/modules/community/sessions";
import { frontPage } from "@/modules/community/front";
import { listPosts } from "@/modules/community/showcase";
import { FrontHero } from "./front-hero";
import { MemberGrid } from "./members/member-grid";
import { SessionList } from "./sessions/session-list";
import { PostGrid } from "./showcase/post-grid";
import { ProjectOfMonth } from "./showcase/project-of-month";

// Phase 25: the front door. The community first; the company workspace (projects and payouts)
// is offered to members who build with a team or for clients.

const pillars = [
  { icon: Rocket, title: "Show your work", text: "Share what you build, from a first AI-made app to a product with real users, and get honest, kind feedback." },
  { icon: MessageSquareHeart, title: "Help one another", text: "Experienced developers help vibe coders build safer, cleaner software. Find teammates for your idea, and paid jobs and gigs." },
  { icon: GraduationCap, title: "Learn together", text: "Teaching sessions, mentors and a library of prompts and tools that work on Ghanaian internet and phones." },
  { icon: Briefcase, title: "Run your projects", text: "When you build with a team or for clients, a free workspace tracks projects, invoices and what everyone is owed." },
];

const audience = ["Beginners and non-coders who build with AI tools", "Working developers who want a local peer group", "Students who want real projects and feedback", "Founders who need a prototype reviewed"];

export default async function HomePage() {
  const [signedIn, stats, recent, projects, sessions, front] = await Promise.all([
    getSignedIn(),
    communityStats(),
    listMembers(null),
    listPosts(null),
    listSessions("upcoming", { limit: 4 }),
    frontPage(),
  ]);
  const open = signupOpen();

  return (
    <div className="space-y-16">
      <FrontHero front={front}>
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">Built in Ghana, for Ghana&apos;s builders</p>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">{PRODUCT_NAME}</h1>
        <p className="max-w-2xl text-base text-white/90 sm:text-lg">
          A home for people in Ghana who build software, whether you write every line yourself or build with AI tools like Claude, Cursor or Lovable. Finish
          projects, show them, and get better together.
        </p>
        <div className="flex flex-wrap gap-3">
          {signedIn ? (
            <Link href="/community" className={buttonClass("primary")}>
              Go to the community <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : open ? (
            <Link href="/sign-up" className={buttonClass("primary")}>
              Join for free <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <Link href="/sign-in" className={buttonClass("primary")}>
              Sign in
            </Link>
          )}
          <Link href="/members" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-white/10 px-3.5 py-2 text-sm font-medium text-white backdrop-blur-sm hover:bg-white/20">
            Meet the members
          </Link>
        </div>
        {stats.members > 0 && (
          <p className="text-sm text-white/80">
            {stats.members} {stats.members === 1 ? "member" : "members"}
            {stats.reviewers > 0 && ` · ${stats.reviewers} ${stats.reviewers === 1 ? "reviewer" : "reviewers"}`}
            {stats.cities > 0 && ` · ${stats.cities} ${stats.cities === 1 ? "city" : "cities"}`}
          </p>
        )}
      </FrontHero>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map(({ icon: Icon, title, text }) => (
          <div key={title} className="space-y-2 rounded-xl border border-line bg-surface p-5 shadow-xs">
            <Icon className="size-6 text-brand-600 dark:text-brand-400" aria-hidden />
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>

      <ProjectOfMonth leaders={false} />

      {projects.posts.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Latest projects</h2>
            <Link href="/showcase" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              The showcase <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <PostGrid posts={projects.posts.slice(0, 3)} />
        </section>
      )}

      {sessions.sessions.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Upcoming teaching sessions</h2>
            <Link href="/sessions" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              All sessions <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <SessionList sessions={sessions.sessions} />
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Who it is for</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            {audience.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            All skill levels are welcome. Read the{" "}
            <Link href="/code-of-conduct" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              code of conduct
            </Link>
            .
          </p>
        </div>
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">New members</h2>
            <Link href="/members" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              All members <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <MemberGrid members={recent.members.slice(0, 6)} compact />
        </div>
      </section>
    </div>
  );
}
