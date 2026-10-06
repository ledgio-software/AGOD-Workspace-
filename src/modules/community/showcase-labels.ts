// Phase 26: showcase labels, shared by the server and the post form's live preview.

export const FEEDBACK_AREAS = { DESIGN: "Design", CODE: "Code quality", SECURITY: "Security", IDEA: "The idea", UX: "User experience" } as const;
export const NEEDS = { TESTERS: "Testers", FEEDBACK: "Feedback", USERS: "Users", COLLABORATORS: "Collaborators" } as const;
export const STATUS_LABEL = { NEEDS_REVIEW: "Needs review", REVIEWED: "Reviewed", SHIPPED: "Shipped" } as const;
export type PostStatus = keyof typeof STATUS_LABEL;
export const STATUS_TONE = { NEEDS_REVIEW: "amber", REVIEWED: "blue", SHIPPED: "green" } as const;

/** Where a video demo is hosted, for its link label. */
export function videoHost(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "YouTube";
  if (/(^|\.)loom\.com$/.test(host)) return "Loom";
  if (/^drive\.google\.com$/.test(host)) return "Google Drive";
  if (/(^|\.)vimeo\.com$/.test(host)) return "Vimeo";
  return "Video";
}
