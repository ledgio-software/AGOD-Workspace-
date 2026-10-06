import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { todayInOperatingZone } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { hostingStatus } from "@/modules/community/sessions";
import { createSessionAction } from "../../actions";
import { SessionForm } from "../session-form";

const IDEAS = [
  "Prompting basics for building apps with AI",
  "Reading and fixing code an AI wrote for you",
  "Publishing your first project online",
  "Keeping API keys and user data safe",
  "Live code review: bring a project and get feedback",
];

export default async function NewSessionPage() {
  const { member } = await requireMember();
  const status = await hostingStatus(member);
  const today = todayInOperatingZone();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Teaching sessions" title="Host a session" description="Pick a topic that fits an hour, share your screen, build something small live, and leave 10 minutes for questions." />
      {!status.allowed ? (
        <Callout tone="warn">
          {status.reason}{" "}
          <Link href="/community/profile" className="font-medium underline">
            Open my profile
          </Link>
        </Callout>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SessionForm
              action={createSessionAction}
              today={today}
              submitLabel="Put it on the board"
              defaults={{ title: "", description: "", level: "ALL", topics: [], date: today, time: "18:00", durationMinutes: 60, callUrl: "", capacity: null }}
            />
          </Card>
          <Card title="Session ideas" aside={<Lightbulb className="size-4 text-muted" aria-hidden />}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
              {IDEAS.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Afterwards, add the recording or your notes for people who missed it.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
