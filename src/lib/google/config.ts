// Phase 21: Google API settings. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET come from a Google Cloud
// OAuth client (docs/GOOGLE.md). GOOGLE_API_BASE_FOR_TESTS points every Google host at a local fake
// server; it is ignored on Vercel.

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  userInfoUrl: string;
  driveUrl: string;
  driveUploadUrl: string;
  calendarUrl: string;
};

type Source = Record<string, string | undefined>;

export function googleConfig(source: Source = process.env): GoogleConfig | null {
  const clientId = source.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const fake = !source.VERCEL && source.GOOGLE_API_BASE_FOR_TESTS?.trim().replace(/\/$/, "");
  if (fake) {
    return {
      clientId,
      clientSecret,
      authUrl: `${fake}/o/oauth2/v2/auth`,
      tokenUrl: `${fake}/token`,
      revokeUrl: `${fake}/revoke`,
      userInfoUrl: `${fake}/oauth2/v3/userinfo`,
      driveUrl: `${fake}/drive/v3`,
      driveUploadUrl: `${fake}/upload/drive/v3`,
      calendarUrl: `${fake}/calendar/v3`,
    };
  }
  return {
    clientId,
    clientSecret,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    driveUrl: "https://www.googleapis.com/drive/v3",
    driveUploadUrl: "https://www.googleapis.com/upload/drive/v3",
    calendarUrl: "https://www.googleapis.com/calendar/v3",
  };
}

/**
 * What the company account allows the app to do. drive.file only reaches files and folders the app
 * itself created (so the app never sees the rest of that Drive); calendar is for the shared AGOD
 * calendar and project meetings (Phases 22-23).
 */
export const COMPANY_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar",
];
