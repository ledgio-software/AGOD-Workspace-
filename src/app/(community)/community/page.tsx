import Link from "next/link";
import { ArrowRight, Building2, CircleCheck, Circle, Flag, MessageCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, PageHeader, buttonClass } from "@/components/ui";
import { companiesOf, requireMember } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { canModerate, chatLinks, ensureProfile, listMembers, listReports, onboarding } from "@/modules/community";
import { switchCompanyAction } from "../../(authenticated)/company/actions";
import { MemberGrid } from "../../(public)/members/member-grid";
import { AcceptConductForm, CreateCompanyForm } from "./forms";

function Step({ done, title, children, soon }: { done: boolean; title: string; children?: React.ReactNode; soon?: boolean }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      {done ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-500" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-line-strong" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-2">
        <p className={done ? "text-muted line-through" : "font-medium"}>
          {title} {soon && <Badge>Coming soon</Badge>}
        </p>
        {!done && children}
      </div>
    </li>
  );
}

export default async function CommunityHomePage() {
  const { member } = await requireMember();
  const profile = await ensureProfile(member);
  const [steps, companies, organizer, recent] = await Promise.all([onboarding(profile), companiesOf(member.id), canModerate(member), listMembers(member)]);
  const openReports = organizer ? (await listReports(member)).filter((r) => r.status === "OPEN").length : 0;
  const chat = chatLinks();
  const firstName = member.name.split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title={`Welcome, ${firstName}`}
        description="A home for people in Ghana who build software, by hand or with AI tools: share your work, get honest feedback and help one another."
        actions={
          <Link href={`/members/${profile.handle}`} className={buttonClass("secondary", "sm")}>
            View my profile
          </Link>
        }
      />

      {organizer && openReports > 0 && (
        <Callout tone="warn" icon={Flag}>
          {openReports === 1 ? "1 report is" : `${openReports} reports are`} waiting for the organizers.{" "}
          <Link href="/community/reports" className="font-medium underline">
            Review reports
          </Link>
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Get started" description="A few steps to take part.">
            <ol className="divide-y divide-line text-sm">
              <Step done={steps.conduct} title="Agree to the code of conduct">
                <p className="text-muted">
                  Be respectful, no gatekeeping, never share secrets, credit others, give back.{" "}
                  <Link href="/code-of-conduct" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Read it
                  </Link>
                  .
                </p>
                <AcceptConductForm />
              </Step>
              <Step done={steps.profile} title="Complete your profile">
                <p className="text-muted">Say what you build, your city and the tools you use, so others can find you.</p>
                <Link href="/community/profile" className={buttonClass("primary", "sm")}>
                  Edit my profile
                </Link>
              </Step>
              <Step done={false} title="Introduce yourself in the chat">
                {chat.discord || chat.whatsapp ? (
                  <div className="flex flex-wrap gap-2">
                    {chat.discord && (
                      <a href={chat.discord} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                        <MessageCircle className="size-4" aria-hidden /> Join the Discord
                      </a>
                    )}
                    {chat.whatsapp && (
                      <a href={chat.whatsapp} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                        <MessageCircle className="size-4" aria-hidden /> Join the WhatsApp group
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-muted">The organizers will share the chat links here soon.</p>
                )}
              </Step>
              <Step done={false} soon title="Share your first project" />
              <Step done={false} soon title="Review someone else's project" />
              <Step done={false} soon title="Join a teaching session" />
            </ol>
          </Card>

          <Card
            title="New members"
            aside={
              <Link href="/members" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                All members <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          >
            <MemberGrid members={recent.members.slice(0, 6)} compact />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Company workspace" aside={<Building2 className="size-4 text-muted" aria-hidden />}>
            <div className="space-y-3 text-sm">
              {companies.length > 0 ? (
                <>
                  <p className="text-muted">Your private workspaces for projects, tasks, invoices and team payouts.</p>
                  <ul className="space-y-2">
                    {companies.map((c) => (
                      <li key={c.id}>
                        <form action={switchCompanyAction}>
                          <input type="hidden" name="companyId" value={c.id} />
                          <button type="submit" className={`${buttonClass("secondary", "sm")} w-full justify-between`}>
                            {c.name} <ArrowRight className="size-4" aria-hidden />
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-muted">
                    Working with a team or a client? A workspace tracks projects and tasks, sends invoices, and shows everyone what they are owed. Free while
                    we test.
                  </p>
                  {signupOpen() ? <CreateCompanyForm /> : <p className="text-muted">If your company already uses it, ask one of its Admins to add you.</p>}
                </>
              )}
            </div>
          </Card>

          <Card title="What's coming" aside={<Sparkles className="size-4 text-muted" aria-hidden />}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Showcase: post your projects with screenshots and video demos</li>
              <li>Review requests with honest, kind feedback</li>
              <li>Teaching sessions with Google Meet links</li>
              <li>Mentorship matching and a tools &amp; prompts library</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
