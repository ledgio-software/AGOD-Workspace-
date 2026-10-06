import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { todayInOperatingZone } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { getSession } from "@/modules/community/sessions";
import { updateSessionAction } from "../../../actions";
import { SessionForm } from "../../session-form";

const zone = process.env.APP_TIMEZONE ?? "Africa/Accra";
const datePart = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const timePart = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireMember();
  const found = await getSession((await params).id, member);
  if (!found || !found.self || found.state === "cancelled" || found.state === "past") notFound();
  const s = found.session;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Teaching sessions" title={`Edit ${s.title}`} description="If you change the time or the call link, everyone who joined gets an email with the new details." />
      <Card>
        <SessionForm
          action={updateSessionAction.bind(null, s.id)}
          today={todayInOperatingZone()}
          submitLabel="Save changes"
          defaults={{
            title: s.title,
            description: s.description,
            level: s.level,
            topics: s.topics,
            date: datePart(s.startsAt),
            time: timePart(s.startsAt),
            durationMinutes: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000),
            callUrl: s.callUrl ?? "",
            capacity: s.capacity,
          }}
        />
      </Card>
    </div>
  );
}
