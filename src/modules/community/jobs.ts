import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communityJobs, jobApplications, memberProfiles, users } from "@/lib/db/schema";
import { addDays } from "@/modules/notifications/deadlines";
import { todayInOperatingZone } from "@/lib/dates";
import { parseMoney } from "@/lib/money";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { jobApplicationMessage, jobApplicationUpdateMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile, fileReport, isOrganizer, reportInput } from "./index";

// Phase 33: the jobs & gigs board. Members post paid work (jobs, gigs, internships) for up to 60
// days; members apply with a short message, which shares their email and profile with the poster.
// The poster shortlists, hires or declines; shortlisting or hiring shares the poster's email with
// the applicant. Jobs and gigs must say what they pay, and nobody may ask applicants for money.

export const JOB_KINDS = { JOB: "Job", GIG: "Gig", INTERNSHIP: "Internship" } as const;
export const WORK_MODES = { REMOTE: "Remote", ONSITE: "On site", HYBRID: "Hybrid" } as const;
export const PAY_UNITS = { PROJECT: "for the work", MONTH: "a month", HOUR: "an hour" } as const;
export type JobKind = keyof typeof JOB_KINDS;
export type ApplicationStatus = "SENT" | "SHORTLISTED" | "HIRED" | "DECLINED" | "WITHDRAWN";

const POSTS_PER_DAY = 5;
const OPEN_JOBS = 10;
const APPLICATIONS_PER_DAY = 20;
export const MAX_DAYS_OPEN = 60;

/** Asking applicants to pay is the most common job scam; posts that do are refused. */
const FEE_SCAM = /\b(registration|application|processing|training|starter|onboarding)\s+(fee|charge)s?\b|\bpay\s+(a\s+)?(fee|deposit)\s+to\s+(apply|start|join)\b/i;

const money = (what: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const minor = parseMoney(v);
      if (minor === null || minor <= 0) {
        ctx.addIssue({ code: "custom", message: `${what}: enter an amount such as 1500 or 1500.50` });
        return z.NEVER;
      }
      return minor;
    });

const list = (max: number, what: string) =>
  z
    .string()
    .max(400)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((l) => l.length <= max, `At most ${max} ${what}`)
    .refine((l) => l.every((t) => t.length <= 40), `Each of the ${what}: at most 40 characters`);

export const jobInput = z
  .object({
    hirer: z.string().trim().min(2, "Say who is hiring (at least 2 characters)").max(120),
    title: z.string().trim().min(5, "Give the job a title (at least 5 characters)").max(120),
    kind: z.enum(["JOB", "GIG", "INTERNSHIP"], { error: "Choose job, gig or internship" }),
    workMode: z.enum(["REMOTE", "ONSITE", "HYBRID"], { error: "Choose remote, on site or hybrid" }),
    location: z
      .string()
      .trim()
      .max(80)
      .transform((v) => v || null),
    payMin: money("Pay"),
    payMax: money("Pay up to"),
    payUnit: z
      .enum(["PROJECT", "MONTH", "HOUR", ""])
      .transform((v) => v || null),
    description: z.string().trim().min(30, "Describe the work (at least 30 characters)").max(5000, "Description: at most 5,000 characters"),
    skills: list(10, "skills"),
    closesOn: z.iso.date({ error: "Choose the closing date" }),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "INTERNSHIP" && v.payMin === null) ctx.addIssue({ code: "custom", path: ["payMin"], message: "Say what it pays: jobs and gigs here always show the pay" });
    if (v.payMin !== null && v.payUnit === null) ctx.addIssue({ code: "custom", path: ["payUnit"], message: "Say if the pay is for the work, a month or an hour" });
    if (v.payMax !== null && (v.payMin === null || v.payMax < v.payMin)) ctx.addIssue({ code: "custom", path: ["payMax"], message: "\"Up to\" must be at least the pay" });
    if (v.workMode !== "REMOTE" && !v.location) ctx.addIssue({ code: "custom", path: ["location"], message: "Say where the work is (city)" });
    if (FEE_SCAM.test(v.description) || FEE_SCAM.test(v.title))
      ctx.addIssue({ code: "custom", path: ["description"], message: "Jobs here never ask applicants to pay anything (no registration, training or application fees)" });
  })
  .transform(({ payMin, payMax, payUnit, ...rest }) => ({ ...rest, payMinMinor: payMin, payMaxMinor: payUnit ? payMax : null, payUnit: payMin === null ? null : payUnit }));

export const applyInput = z.object({
  message: z.string().trim().min(20, "Say why you're a good fit (at least 20 characters)").max(2000, "At most 2,000 characters"),
  link: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`))
    .refine((v) => v === null || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a web address such as https://my-portfolio.com"),
});

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  return profile;
}

function checkClosingDate(closesOn: string, today = todayInOperatingZone()) {
  if (closesOn < today) throw new ServiceError("The closing date has passed. Choose today or later.");
  if (closesOn > addDays(today, MAX_DAYS_OPEN)) throw new ServiceError(`A job can stay open for at most ${MAX_DAYS_OPEN} days.`);
}

// --- Posting ---------------------------------------------------------------------------------

export async function createJob(member: Member, raw: z.input<typeof jobInput>): Promise<string> {
  const input = jobInput.parse(raw);
  await requireConduct(member);
  checkClosingDate(input.closesOn);
  const [{ n: today }] = await db
    .select({ n: count() })
    .from(communityJobs)
    .where(and(eq(communityJobs.posterId, member.id), gte(communityJobs.createdAt, new Date(Date.now() - 86_400_000))));
  if (today >= POSTS_PER_DAY) throw new ServiceError(`You can post ${POSTS_PER_DAY} jobs a day. Try again tomorrow.`);
  const [{ n: open }] = await db
    .select({ n: count() })
    .from(communityJobs)
    .where(and(eq(communityJobs.posterId, member.id), eq(communityJobs.status, "OPEN"), gte(communityJobs.closesOn, todayInOperatingZone())));
  if (open >= OPEN_JOBS) throw new ServiceError(`You have ${OPEN_JOBS} open jobs. Close one before posting another.`);
  const [row] = await db
    .insert(communityJobs)
    .values({ posterId: member.id, ...input })
    .returning({ id: communityJobs.id });
  return row.id;
}

async function ownJob(member: Member, jobId: string) {
  if (!z.uuid().safeParse(jobId).success) throw new ServiceError("Job not found.");
  const [job] = await db.select().from(communityJobs).where(eq(communityJobs.id, jobId));
  if (!job || job.posterId !== member.id) throw new ServiceError("Only the person who posted it can change it.");
  return job;
}

export async function updateJob(member: Member, jobId: string, raw: z.input<typeof jobInput>) {
  const input = jobInput.parse(raw);
  const job = await ownJob(member, jobId);
  if (job.status !== "OPEN") throw new ServiceError("This job is closed. Post a new one instead.");
  checkClosingDate(input.closesOn);
  await db.update(communityJobs).set(input).where(eq(communityJobs.id, jobId));
}

/** Stops taking applications: filled (someone was hired) or just closed. */
export async function closeJob(member: Member, jobId: string, filled: boolean) {
  const job = await ownJob(member, jobId);
  if (job.status !== "OPEN") throw new ServiceError("This job is already closed.");
  await db.update(communityJobs).set({ status: filled ? "FILLED" : "CLOSED", closedAt: new Date() }).where(eq(communityJobs.id, jobId));
}

// --- Reading ---------------------------------------------------------------------------------

export type JobCard = {
  id: string;
  hirer: string;
  title: string;
  kind: JobKind;
  workMode: keyof typeof WORK_MODES;
  location: string | null;
  payMinMinor: number | null;
  payMaxMinor: number | null;
  payUnit: keyof typeof PAY_UNITS | null;
  currency: string;
  skills: string[];
  closesOn: string;
  createdAt: Date;
};

const cardColumns = {
  id: communityJobs.id,
  hirer: communityJobs.hirer,
  title: communityJobs.title,
  kind: communityJobs.kind,
  workMode: communityJobs.workMode,
  location: communityJobs.location,
  payMinMinor: communityJobs.payMinMinor,
  payMaxMinor: communityJobs.payMaxMinor,
  payUnit: communityJobs.payUnit,
  currency: communityJobs.currency,
  skills: communityJobs.skills,
  closesOn: communityJobs.closesOn,
  createdAt: communityJobs.createdAt,
};

const isOpen = () => and(eq(communityJobs.status, "OPEN"), isNull(communityJobs.hiddenAt), gte(communityJobs.closesOn, todayInOperatingZone()));

/** Open jobs, newest first; filters by kind, work mode, skill and words. */
export async function listJobs(filters: { kind?: string; mode?: string; skill?: string; q?: string } = {}): Promise<JobCard[]> {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const skill = filters.skill?.trim().slice(0, 40);
  const rows = await db
    .select(cardColumns)
    .from(communityJobs)
    .where(
      and(
        isOpen(),
        filters.kind && filters.kind in JOB_KINDS ? eq(communityJobs.kind, filters.kind) : undefined,
        filters.mode && filters.mode in WORK_MODES ? eq(communityJobs.workMode, filters.mode) : undefined,
        skill ? sql`lower(${skill}) = ANY (SELECT lower(x) FROM unnest(${communityJobs.skills}) x)` : undefined,
        like
          ? or(ilike(communityJobs.title, like), ilike(communityJobs.hirer, like), ilike(communityJobs.description, like), ilike(communityJobs.location, like), sql`array_to_string(${communityJobs.skills}, ' ') ILIKE ${like}`)
          : undefined,
      ),
    )
    .orderBy(desc(communityJobs.createdAt))
    .limit(200);
  return rows as JobCard[];
}

/** For the home pages: how many jobs are open. */
export async function openJobCount(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(communityJobs).where(isOpen());
  return n;
}

export type JobDetail = JobCard & {
  description: string;
  status: "OPEN" | "CLOSED" | "FILLED";
  open: boolean;
  hidden: boolean;
  posterId: string;
  posterName: string;
  posterHandle: string | null;
  applications: number;
  myApplication: { id: string; status: ApplicationStatus } | null;
};

/** One job. Closed jobs stay readable; hidden ones only for the poster and organizers. */
export async function getJob(viewer: Member | null, jobId: string): Promise<JobDetail | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const [row] = await db
    .select({
      ...cardColumns,
      description: communityJobs.description,
      status: communityJobs.status,
      hiddenAt: communityJobs.hiddenAt,
      posterId: communityJobs.posterId,
      posterName: users.name,
      posterHandle: memberProfiles.handle,
      applications: sql<number>`(select count(*)::int from job_applications a where a.job_id = ${communityJobs.id} and a.status <> 'WITHDRAWN')`,
    })
    .from(communityJobs)
    .innerJoin(users, eq(users.id, communityJobs.posterId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, communityJobs.posterId))
    .where(eq(communityJobs.id, jobId));
  if (!row) return null;
  if (row.hiddenAt && row.posterId !== viewer?.id && !(await viewerIsOrganizer(viewer))) return null;
  const [mine] = viewer
    ? await db.select({ id: jobApplications.id, status: jobApplications.status }).from(jobApplications).where(and(eq(jobApplications.jobId, jobId), eq(jobApplications.applicantId, viewer.id)))
    : [];
  const { hiddenAt, ...rest } = row;
  return {
    ...(rest as Omit<JobDetail, "hidden" | "open" | "myApplication">),
    hidden: hiddenAt !== null,
    open: row.status === "OPEN" && !hiddenAt && row.closesOn >= todayInOperatingZone(),
    myApplication: mine ? { id: mine.id, status: mine.status as ApplicationStatus } : null,
  };
}

async function viewerIsOrganizer(viewer: Member | null) {
  if (!viewer) return false;
  const [p] = await db.select({ communityRole: memberProfiles.communityRole }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id));
  return isOrganizer(p ?? null, viewer.email);
}

// --- Applying --------------------------------------------------------------------------------

/** Applies for an open job (or applies again after withdrawing). Shares the applicant's email and profile with the poster. */
export async function applyToJob(member: Member, jobId: string, raw: z.input<typeof applyInput>): Promise<string> {
  const input = applyInput.parse(raw);
  await requireConduct(member);
  const job = await getJob(member, jobId);
  if (!job) throw new ServiceError("Job not found.");
  if (job.posterId === member.id) throw new ServiceError("You can't apply for your own job.");
  if (!job.open) throw new ServiceError("This job is no longer taking applications.");
  const [{ n }] = await db
    .select({ n: count() })
    .from(jobApplications)
    .where(and(eq(jobApplications.applicantId, member.id), gte(jobApplications.createdAt, new Date(Date.now() - 86_400_000))));
  if (n >= APPLICATIONS_PER_DAY) throw new ServiceError(`You can send ${APPLICATIONS_PER_DAY} applications a day. Try again tomorrow.`);
  const id = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(jobApplications).where(and(eq(jobApplications.jobId, jobId), eq(jobApplications.applicantId, member.id))).for("update");
    if (existing && existing.status !== "WITHDRAWN") throw new ServiceError("You already applied for this job.");
    if (existing) {
      await tx.update(jobApplications).set({ ...input, status: "SENT", decidedAt: null }).where(eq(jobApplications.id, existing.id));
      return existing.id;
    }
    const [row] = await tx.insert(jobApplications).values({ jobId, applicantId: member.id, ...input }).returning({ id: jobApplications.id });
    return row.id;
  });
  const [poster] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, job.posterId));
  await sendAccountEmail(poster.email, jobApplicationMessage({ name: poster.name, applicant: member.name, title: job.title, url: appUrl("/community/jobs") })).catch((error) =>
    console.error("Job application email failed", id, error instanceof Error ? error.message : error),
  );
  return id;
}

export async function withdrawApplication(member: Member, applicationId: string) {
  const [updated] = await db
    .update(jobApplications)
    .set({ status: "WITHDRAWN" })
    .where(and(eq(jobApplications.id, applicationId), eq(jobApplications.applicantId, member.id), inArray(jobApplications.status, ["SENT", "SHORTLISTED"])))
    .returning({ id: jobApplications.id });
  if (!updated) throw new ServiceError("There's no open application to withdraw.");
}

const NEXT: Record<string, ApplicationStatus[]> = { SENT: ["SHORTLISTED", "HIRED", "DECLINED"], SHORTLISTED: ["HIRED", "DECLINED"] };

/** The poster shortlists, hires or declines an applicant; the applicant gets an email. */
export async function setApplicationStatus(member: Member, applicationId: string, status: "SHORTLISTED" | "HIRED" | "DECLINED") {
  if (!["SHORTLISTED", "HIRED", "DECLINED"].includes(status)) throw new ServiceError("Choose shortlist, hire or decline.");
  if (!z.uuid().safeParse(applicationId).success) throw new ServiceError("Application not found.");
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ app: jobApplications, posterId: communityJobs.posterId, title: communityJobs.title, hirer: communityJobs.hirer })
      .from(jobApplications)
      .innerJoin(communityJobs, eq(communityJobs.id, jobApplications.jobId))
      .where(eq(jobApplications.id, applicationId))
      .for("update", { of: jobApplications });
    if (!row || row.posterId !== member.id) throw new ServiceError("Application not found.");
    if (!(NEXT[row.app.status] ?? []).includes(status)) throw new ServiceError("This application can't be changed any more.");
    await tx.update(jobApplications).set({ status, decidedAt: new Date() }).where(eq(jobApplications.id, applicationId));
    return row;
  });
  const [applicant] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, result.app.applicantId));
  await sendAccountEmail(
    applicant.email,
    jobApplicationUpdateMessage({ name: applicant.name, title: result.title, hirer: result.hirer, status, posterEmail: status === "DECLINED" ? null : member.email, url: appUrl("/community/jobs") }),
  ).catch((error) => console.error("Job update email failed", applicationId, error instanceof Error ? error.message : error));
}

export type ApplicationView = {
  id: string;
  status: ApplicationStatus;
  message: string;
  link: string | null;
  createdAt: Date;
  person: { id: string; name: string; handle: string | null; email: string | null };
};

export type MyJobs = {
  posted: (JobCard & { status: string; open: boolean; hidden: boolean; applications: ApplicationView[] })[];
  applied: (ApplicationView & { job: { id: string; title: string; hirer: string; open: boolean } })[];
};

/** My jobs with their applicants, and my own applications. */
export async function myJobs(member: Member): Promise<MyJobs> {
  const today = todayInOperatingZone();
  const posted = await db
    .select({ ...cardColumns, status: communityJobs.status, hiddenAt: communityJobs.hiddenAt })
    .from(communityJobs)
    .where(eq(communityJobs.posterId, member.id))
    .orderBy(desc(communityJobs.createdAt))
    .limit(50);
  const people = (alias: typeof users) => ({ id: alias.id, name: alias.name, email: alias.email, handle: memberProfiles.handle });
  const received = posted.length
    ? await db
        .select({ app: jobApplications, person: people(users) })
        .from(jobApplications)
        .innerJoin(users, eq(users.id, jobApplications.applicantId))
        .leftJoin(memberProfiles, eq(memberProfiles.userId, jobApplications.applicantId))
        .where(and(inArray(jobApplications.jobId, posted.map((j) => j.id)), sql`${jobApplications.status} <> 'WITHDRAWN'`))
        .orderBy(desc(jobApplications.createdAt))
    : [];
  const mine = await db
    .select({ app: jobApplications, job: communityJobs, person: people(users) })
    .from(jobApplications)
    .innerJoin(communityJobs, eq(communityJobs.id, jobApplications.jobId))
    .innerJoin(users, eq(users.id, communityJobs.posterId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, communityJobs.posterId))
    .where(eq(jobApplications.applicantId, member.id))
    .orderBy(desc(jobApplications.createdAt))
    .limit(100);
  const view = (a: typeof jobApplications.$inferSelect, p: { id: string; name: string; email: string; handle: string | null }, shareEmail: boolean): ApplicationView => ({
    id: a.id,
    status: a.status as ApplicationStatus,
    message: a.message,
    link: a.link,
    createdAt: a.createdAt,
    person: { id: p.id, name: p.name, handle: p.handle, email: shareEmail ? p.email : null },
  });
  return {
    posted: posted.map(({ hiddenAt, ...j }) => ({
      ...(j as JobCard & { status: string }),
      hidden: hiddenAt !== null,
      open: j.status === "OPEN" && !hiddenAt && j.closesOn >= today,
      // Applying shares the applicant's email with the poster.
      applications: received.filter((r) => r.app.jobId === j.id).map((r) => view(r.app, r.person, true)),
    })),
    applied: mine.map((r) => ({
      // The poster's email once they shortlist or hire.
      ...view(r.app, r.person, r.app.status === "SHORTLISTED" || r.app.status === "HIRED"),
      job: { id: r.job.id, title: r.job.title, hirer: r.job.hirer, open: r.job.status === "OPEN" && !r.job.hiddenAt && r.job.closesOn >= today },
    })),
  };
}

// --- Moderation ------------------------------------------------------------------------------

export async function reportJob(member: Member, jobId: string, raw: z.input<typeof reportInput>) {
  const job = await getJob(member, jobId);
  if (!job) throw new ServiceError("Job not found.");
  if (job.posterId === member.id) throw new ServiceError("You can't report your own job.");
  await fileReport(member, "JOB", jobId, raw);
}

export async function unhideJob(member: Member, jobId: string) {
  if (!(await viewerIsOrganizer(member))) throw new ServiceError("Only community organizers can do that.");
  await db.update(communityJobs).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(eq(communityJobs.id, jobId));
}
