import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, CircleCheck, Clock, EyeOff, PlayCircle, Users, Video } from "lucide-react";
import { Badge } from "@/components/badges";
import { Avatar, Callout, Card, Disclosure, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { LEVELS, getSession } from "@/modules/community/sessions";
import {
  addRecordingAction,
  cancelSessionAction,
  joinSessionAction,
  leaveSessionAction,
  reportSessionAction,
  unhideSessionAction,
} from "../../../(community)/community/actions";
import { ReportForm } from "../../../(community)/community/forms";
import { CancelSessionForm, RecordingForm } from "../../../(community)/community/sessions/forms";
import { ButtonForm } from "../../../(community)/community/showcase/forms";
import { pageMetadata } from "@/lib/site";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ scheduled?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await getSession((await params).id, await getSignedIn());
  return found ? pageMetadata(found.session.title, found.session.description) : { title: "Session" };
}

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);
const length = (m: number) => (m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${Math.floor(m / 60)} h ${m % 60} min`);

export default async function SessionPage({ params, searchParams }: Params) {
  const viewer = await getSignedIn();
  const found = await getSession((await params).id, viewer);
  if (!found) notFound();
  const { session: s, host, attendees, self, organizer, joined, full, state, provider } = found;
  const flags = await searchParams;
  const upcoming = state === "upcoming" || state === "live";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {flags.scheduled && self && (
        <Callout tone="good" icon={CircleCheck}>
          Your session is on the board. Share its link in the chat so people join.
        </Callout>
      )}
      {s.hiddenAt && (
        <Callout tone="bad" icon={EyeOff}>
          Hidden by the organizers{s.hiddenReason ? `: ${s.hiddenReason}` : "."}
        </Callout>
      )}
      {state === "cancelled" && (
        <Callout tone="warn" icon={Clock}>
          This session was cancelled{s.cancelReason ? `: ${s.cancelReason}` : "."}
        </Callout>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {state === "live" && <Badge tone="red">Live now</Badge>}
          {state === "past" && <Badge>Past session</Badge>}
          <Badge tone="blue">{LEVELS[s.level as keyof typeof LEVELS] ?? s.level}</Badge>
          {s.topics.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{s.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden /> {formatDateTime(s.startsAt)} (Accra) · {length(minutes(s.startsAt, s.endsAt))}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Video className="size-4" aria-hidden /> on {provider}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4" aria-hidden /> {attendees.length} joined{s.capacity !== null && ` of ${s.capacity}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Avatar name={host.name} size="sm" />
          <span className="text-muted">Hosted by</span>
          {host.handle ? (
            <Link href={`/members/${host.handle}`} className="font-medium hover:underline">
              {host.name}
            </Link>
          ) : (
            <span className="font-medium">{host.name}</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="About this session">
            <p className="whitespace-pre-line break-words text-sm">{s.description}</p>
          </Card>

          {(s.recordingUrl || s.notes) && (
            <Card title="Recording and notes">
              <div className="space-y-3 text-sm">
                {s.recordingUrl && (
                  <a href={s.recordingUrl} target="_blank" rel="nofollow ugc noopener noreferrer" className={buttonClass("primary", "sm")}>
                    <PlayCircle className="size-4" aria-hidden /> Watch the recording
                  </a>
                )}
                {s.notes && <p className="whitespace-pre-line break-words">{s.notes}</p>}
              </div>
            </Card>
          )}

          {attendees.length > 0 && viewer && (
            <Card title={`Who's coming (${attendees.length})`}>
              <ul className="flex flex-wrap gap-2 text-sm">
                {attendees.map((a) => (
                  <li key={a.userId}>
                    {a.handle ? (
                      <Link href={`/members/${a.handle}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 hover:bg-surface-muted">
                        {a.name}
                      </Link>
                    ) : (
                      <span className="rounded-full border border-line px-2.5 py-1">{a.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title={self ? "You're hosting" : joined ? "You're in" : "Take part"}>
            <div className="space-y-3 text-sm">
              {s.callUrl && upcoming && (
                <a href={s.callUrl} target="_blank" rel="noopener noreferrer" className={`${buttonClass("primary", "sm")} w-full justify-center`}>
                  <Video className="size-4" aria-hidden /> Open the call ({provider})
                </a>
              )}
              {!viewer && upcoming && (
                <p className="text-muted">
                  <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Sign in
                  </Link>{" "}
                  to join and get the call link.
                </p>
              )}
              {viewer && !self && !joined && upcoming && !full && (
                <ButtonForm action={joinSessionAction.bind(null, s.id)} label="Join this session" variant="primary" />
              )}
              {viewer && !self && !joined && full && upcoming && <p className="text-muted">This session is full.</p>}
              {viewer && joined && upcoming && (
                <p className="text-muted">The call link is above. We&apos;ll email you a reminder on the day.</p>
              )}
              {upcoming && (
                <a href={`/sessions/${s.id}/calendar.ics`} className={`${buttonClass("secondary", "sm")} w-full justify-center`}>
                  <CalendarPlus className="size-4" aria-hidden /> Add to calendar
                </a>
              )}
              {viewer && joined && upcoming && state !== "live" && (
                <ButtonForm action={leaveSessionAction.bind(null, s.id)} label="Leave (give your seat back)" confirmMessage="Leave this session?" />
              )}
              {state === "past" && !s.recordingUrl && !s.notes && <p className="text-muted">This session is over.</p>}
            </div>
          </Card>

          {self && state !== "cancelled" && (
            <Card title="Host tools">
              <div className="space-y-4 text-sm">
                {upcoming && (
                  <Link href={`/community/sessions/${s.id}/edit`} className={buttonClass("secondary", "sm")}>
                    Edit
                  </Link>
                )}
                {state !== "upcoming" && (
                  <div className="space-y-2">
                    <p className="font-medium">After the session</p>
                    <RecordingForm action={addRecordingAction.bind(null, s.id)} recordingUrl={s.recordingUrl} notes={s.notes} />
                  </div>
                )}
                {upcoming && (
                  <Disclosure summary="Cancel the session">
                    <CancelSessionForm action={cancelSessionAction.bind(null, s.id)} />
                  </Disclosure>
                )}
              </div>
            </Card>
          )}

          {organizer && !self && (
            <Card title="Organizer tools">
              <div className="space-y-3">
                {s.hiddenAt && <ButtonForm action={unhideSessionAction.bind(null, s.id)} label="Show the session again" />}
                {upcoming && (
                  <Disclosure summary="Cancel the session">
                    <CancelSessionForm action={cancelSessionAction.bind(null, s.id)} />
                  </Disclosure>
                )}
              </div>
            </Card>
          )}

          {viewer && !self && !s.hiddenAt && (
            <Disclosure summary="Report this session">
              <ReportForm action={reportSessionAction.bind(null, s.id)} />
            </Disclosure>
          )}
        </div>
      </div>
    </div>
  );
}
