import { createHash, randomBytes } from "node:crypto";
import type { GoogleConfig } from "./config";

// Phase 21: the few Google REST calls the app makes, with fetch (no SDK). Each call takes an access
// token; tokens are obtained from a stored refresh token by refreshAccessToken.

export class GoogleError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

async function check(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  let reason: string | null = null;
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string; errors?: { reason?: string }[] } | string; error_description?: string };
    if (typeof body.error === "string") {
      reason = body.error;
      detail = body.error_description ?? body.error;
    } else {
      reason = body.error?.errors?.[0]?.reason ?? null;
      detail = body.error?.message ?? "";
    }
  } catch {
    // not JSON
  }
  throw new GoogleError(`Google refused ${what} (${response.status})${detail ? `: ${detail}` : ""}`, response.status, reason);
}

const TIMEOUT = 20_000;

// --- OAuth -----------------------------------------------------------------------------------

/** PKCE pair and state for one sign-in attempt. */
export function newAuthRequest() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(24).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function authorizationUrl(config: GoogleConfig, o: { redirectUri: string; scopes: string[]; state: string; challenge: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: o.scopes.join(" "),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    // A refresh token, every time (so reconnecting works after a disconnect).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (o.loginHint) params.set("login_hint", o.loginHint);
  return `${config.authUrl}?${params}`;
}

export async function exchangeCode(config: GoogleConfig, o: { code: string; verifier: string; redirectUri: string }) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: o.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: o.redirectUri,
      grant_type: "authorization_code",
      code_verifier: o.verifier,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "the sign-in");
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

export async function refreshAccessToken(config: GoogleConfig, refreshToken: string) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "the access token");
  return (await response.json()) as { access_token: string; expires_in: number };
}

export async function revokeToken(config: GoogleConfig, token: string) {
  await fetch(config.revokeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => undefined);
}

export async function userEmail(config: GoogleConfig, accessToken: string): Promise<string> {
  const response = await fetch(config.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT) });
  await check(response, "the account details");
  const body = (await response.json()) as { email?: string; email_verified?: boolean };
  if (!body.email) throw new GoogleError("Google did not return the account's email", 400);
  return body.email.toLowerCase();
}

// --- Drive ------------------------------------------------------------------------------------

export type DriveFile = { id: string; name: string; mimeType: string; webViewLink?: string; size?: string; modifiedTime?: string; iconLink?: string };

const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,webViewLink,size,modifiedTime,iconLink";

export async function createFolder(config: GoogleConfig, token: string, name: string, parentId?: string | null): Promise<DriveFile> {
  const response = await fetch(`${config.driveUrl}/files?fields=${FIELDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "creating a folder");
  return (await response.json()) as DriveFile;
}

/** Builds a multipart/related upload body (metadata + file), as the Drive upload API expects. */
export function multipartBody(metadata: object, bytes: Uint8Array, contentType: string) {
  const boundary = `agod-${randomBytes(12).toString("hex")}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, Buffer.from(bytes), tail]), contentType: `multipart/related; boundary=${boundary}` };
}

export async function uploadFile(
  config: GoogleConfig,
  token: string,
  o: { name: string; parentId: string; bytes: Uint8Array; contentType: string; description?: string },
): Promise<DriveFile> {
  const { body, contentType } = multipartBody({ name: o.name, parents: [o.parentId], ...(o.description ? { description: o.description } : {}) }, o.bytes, o.contentType);
  const response = await fetch(`${config.driveUploadUrl}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  await check(response, "the upload");
  return (await response.json()) as DriveFile;
}

export async function downloadFile(config: GoogleConfig, token: string, fileId: string): Promise<Uint8Array | null> {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) return null;
  await check(response, "the download");
  return new Uint8Array(await response.arrayBuffer());
}

export async function listFolder(config: GoogleConfig, token: string, folderId: string, limit = 50): Promise<DriveFile[]> {
  const q = `'${folderId.replace(/'/g, "")}' in parents and trashed = false`;
  const params = new URLSearchParams({ q, fields: `files(${FIELDS})`, orderBy: "folder,modifiedTime desc", pageSize: String(limit) });
  const response = await fetch(`${config.driveUrl}/files?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
  await check(response, "listing the folder");
  return ((await response.json()) as { files: DriveFile[] }).files ?? [];
}

export type DrivePermission = { id: string; type: string; role: string; emailAddress?: string };

export async function listPermissions(config: GoogleConfig, token: string, fileId: string): Promise<DrivePermission[]> {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,emailAddress)`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "reading the sharing");
  return ((await response.json()) as { permissions: DrivePermission[] }).permissions ?? [];
}

export async function shareWith(config: GoogleConfig, token: string, fileId: string, email: string, role: "writer" | "reader") {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "user", role, emailAddress: email }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, `sharing with ${email}`);
}

export async function unshare(config: GoogleConfig, token: string, fileId: string, permissionId: string) {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) return;
  await check(response, "removing access");
}

/** A file's basic details; null when it doesn't exist (any more). */
export async function getFile(config: GoogleConfig, token: string, fileId: string): Promise<(DriveFile & { trashed?: boolean }) | null> {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}?fields=${FIELDS},trashed`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) return null;
  await check(response, "reading the file");
  return (await response.json()) as DriveFile & { trashed?: boolean };
}

/** Deletes a file the app created (drive.file). Already gone counts as done. */
export async function deleteFile(config: GoogleConfig, token: string, fileId: string) {
  const response = await fetch(`${config.driveUrl}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) return;
  await check(response, "deleting the file");
}

/** Link that opens a Drive file or folder in the browser. */
export const driveFileUrl = (fileId: string) => `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
export const driveFolderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;

// --- Calendar (Phase 24) ----------------------------------------------------------------------

export type CalendarEventInput = {
  summary: string;
  description?: string;
  /** All-day event on this date (YYYY-MM-DD)... */
  date?: string;
  /** ...or a timed event. */
  start?: Date;
  end?: Date;
  timeZone?: string;
  attendees?: string[];
  /** Ask Google to add a Meet link. */
  meet?: boolean;
};
export type CalendarEvent = { id: string; htmlLink?: string; hangoutLink?: string; status?: string };
export type CalendarAclRule = { id: string; role: string; scope: { type: string; value?: string } };

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function eventBody(e: CalendarEventInput, requestId?: string) {
  const time = e.date
    ? { start: { date: e.date }, end: { date: nextDay(e.date) } }
    : { start: { dateTime: e.start!.toISOString(), timeZone: e.timeZone }, end: { dateTime: e.end!.toISOString(), timeZone: e.timeZone } };
  return {
    summary: e.summary,
    description: e.description ?? "",
    ...time,
    // Deadlines don't block anyone's time.
    ...(e.date ? { transparency: "transparent" } : {}),
    ...(e.attendees ? { attendees: e.attendees.map((email) => ({ email })) } : {}),
    ...(e.meet && requestId ? { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}

const calendarPath = (config: GoogleConfig, calendarId: string) => `${config.calendarUrl}/calendars/${encodeURIComponent(calendarId)}`;

export async function createCalendar(config: GoogleConfig, token: string, summary: string, timeZone: string): Promise<{ id: string }> {
  const response = await fetch(`${config.calendarUrl}/calendars`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary, timeZone }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "creating the calendar");
  return (await response.json()) as { id: string };
}

/** The calendar, or null when it was deleted. */
export async function getCalendar(config: GoogleConfig, token: string, calendarId: string): Promise<{ id: string; summary: string } | null> {
  const response = await fetch(calendarPath(config, calendarId), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
  if (response.status === 404) return null;
  await check(response, "reading the calendar");
  return (await response.json()) as { id: string; summary: string };
}

export async function listCalendarAcl(config: GoogleConfig, token: string, calendarId: string): Promise<CalendarAclRule[]> {
  const response = await fetch(`${calendarPath(config, calendarId)}/acl`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
  await check(response, "reading the calendar sharing");
  return ((await response.json()) as { items?: CalendarAclRule[] }).items ?? [];
}

export async function shareCalendar(config: GoogleConfig, token: string, calendarId: string, email: string, role: "reader" | "writer") {
  const response = await fetch(`${calendarPath(config, calendarId)}/acl?sendNotifications=false`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role, scope: { type: "user", value: email } }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, `sharing the calendar with ${email}`);
}

export async function unshareCalendar(config: GoogleConfig, token: string, calendarId: string, ruleId: string) {
  const response = await fetch(`${calendarPath(config, calendarId)}/acl/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404 || response.status === 410) return;
  await check(response, "removing calendar access");
}

/** Creates an event; with `meet` (and a request id), Google adds a Meet link; `notify` emails the attendees. */
export async function insertEvent(
  config: GoogleConfig,
  token: string,
  calendarId: string,
  event: CalendarEventInput,
  o: { requestId?: string; notify?: boolean } = {},
): Promise<CalendarEvent> {
  const params = new URLSearchParams({ sendUpdates: o.notify ? "all" : "none", ...(event.meet ? { conferenceDataVersion: "1" } : {}) });
  const response = await fetch(`${calendarPath(config, calendarId)}/events?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(event, o.requestId)),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "creating the event");
  return (await response.json()) as CalendarEvent;
}

/** Replaces an event's details; null when the event no longer exists. */
export async function updateEvent(config: GoogleConfig, token: string, calendarId: string, eventId: string, event: CalendarEventInput): Promise<CalendarEvent | null> {
  const response = await fetch(`${calendarPath(config, calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(event)),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404 || response.status === 410) return null;
  await check(response, "updating the event");
  return (await response.json()) as CalendarEvent;
}

export async function deleteEvent(config: GoogleConfig, token: string, calendarId: string, eventId: string, notify = false) {
  const response = await fetch(`${calendarPath(config, calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${notify ? "all" : "none"}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404 || response.status === 410) return;
  await check(response, "deleting the event");
}

/** Opens a calendar in Google Calendar (for people it is shared with). */
export const calendarUrl = (calendarId: string) => `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`;

/** Sets an event's guests and has Google email them the invitation. */
export async function inviteToEvent(config: GoogleConfig, token: string, calendarId: string, eventId: string, emails: string[]) {
  const response = await fetch(`${calendarPath(config, calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ attendees: emails.map((email) => ({ email })) }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  await check(response, "inviting the team");
}
