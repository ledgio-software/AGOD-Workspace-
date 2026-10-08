import { PRODUCT_NAME } from "@/lib/brand";

// Phase 23: emails about a person's login (verify, reset password, invitations). Pure, so their
// wording and escaping are unit-tested.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** One short message with a single button. */
function message(o: { subject: string; name: string; lines: string[]; button?: { label: string; url: string }; footer: string }) {
  const text = [
    `Hi ${firstName(o.name)},`,
    "",
    ...o.lines,
    ...(o.button ? ["", `${o.button.label}: ${o.button.url}`] : []),
    "",
    o.footer,
    "",
    `— ${PRODUCT_NAME}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:24px">
<div style="font-weight:700;font-size:16px;margin-bottom:16px">${escapeHtml(PRODUCT_NAME)}</div>
<p style="margin:0 0 8px">Hi ${escapeHtml(firstName(o.name))},</p>
${o.lines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("\n")}
${
  o.button
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml(o.button.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(o.button.label)}</a></p>
<p style="margin:12px 0 0;color:#71717a;font-size:12px;word-break:break-all">Or open this link: ${escapeHtml(o.button.url)}</p>`
    : ""
}
<p style="margin:20px 0 0;color:#71717a;font-size:12px">${escapeHtml(o.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: o.subject, text, html };
}

export function verifyEmailMessage(o: { name: string; url: string }) {
  return message({
    subject: `Confirm your email for ${PRODUCT_NAME}`,
    name: o.name,
    lines: ["Thanks for signing up. Confirm your email address to finish joining the community."],
    button: { label: "Confirm my email", url: o.url },
    footer: "The link works for 24 hours. If you didn't sign up, ignore this email.",
  });
}

export function resetPasswordMessage(o: { name: string; url: string }) {
  return message({
    subject: `Reset your ${PRODUCT_NAME} password`,
    name: o.name,
    lines: ["Someone (hopefully you) asked to reset your password. Choose a new one with the button below."],
    button: { label: "Choose a new password", url: o.url },
    footer: "The link works for 1 hour and only once. If you didn't ask for this, ignore this email: your password stays the same.",
  });
}

export function inviteMessage(o: { name: string; company: string; invitedBy: string; url: string }) {
  return message({
    subject: `${o.invitedBy} invited you to ${o.company}`,
    name: o.name,
    lines: [`${o.invitedBy} added you to ${o.company} on ${PRODUCT_NAME}, where the team tracks projects, tasks and payouts.`, "Choose your password to sign in."],
    button: { label: "Choose my password", url: o.url },
    footer: "The link works for 7 days and only once. Ask the person who invited you for a new one if it expires.",
  });
}

export function addedToCompanyMessage(o: { name: string; company: string; invitedBy: string; url: string }) {
  return message({
    subject: `You were added to ${o.company}`,
    name: o.name,
    lines: [`${o.invitedBy} added you to ${o.company}.`, "Sign in with your usual password and choose the company from the company menu at the top of the sidebar."],
    button: { label: "Sign in", url: o.url },
    footer: "If you don't know this company, you can ignore this email; nothing changes for your other companies.",
  });
}

export function existingSignUpMessage(o: { name: string; signInUrl: string; resetUrl: string }) {
  return message({
    subject: `Someone tried to sign up with your email`,
    name: o.name,
    lines: [
      `Someone tried to create a new ${PRODUCT_NAME} account with this email address, but you already have one.`,
      `If it was you, sign in instead (${o.signInUrl}) or reset your password (${o.resetUrl}).`,
    ],
    footer: "If it wasn't you, you don't need to do anything: no account was changed.",
  });
}

/** Phase 26: someone reviewed a member's showcase project. */
export function newReviewMessage(o: { name: string; reviewer: string; title: string; url: string }) {
  return message({
    subject: `New feedback on ${o.title}`,
    name: o.name,
    lines: [`${o.reviewer} reviewed ${o.title} in the showcase.`, "Read it, thank them, and reply if you have a question."],
    button: { label: "Read the feedback", url: o.url },
    footer: "You get this email when someone reviews one of your projects.",
  });
}

/** Phase 27: someone joined a teaching session (the .ics file is attached by the sender). */
export function sessionJoinedMessage(o: { name: string; title: string; when: string; host: string; callUrl: string; url: string }) {
  return message({
    subject: `You're in: ${o.title}`,
    name: o.name,
    lines: [
      `You joined "${o.title}" with ${o.host}, ${o.when} (Accra time).`,
      `Join the call here when it starts: ${o.callUrl}`,
      "The attached file adds it to your calendar. We'll also remind you on the day.",
    ],
    button: { label: "See the session", url: o.url },
    footer: "Can't come after all? Leave the session on its page so someone else can take your place.",
  });
}

export function sessionReminderMessage(o: { name: string; title: string; when: string; callUrl: string; url: string }) {
  return message({
    subject: `Today: ${o.title}`,
    name: o.name,
    lines: [`Reminder: "${o.title}" is ${o.when} (Accra time).`, `Join the call here: ${o.callUrl}`],
    button: { label: "See the session", url: o.url },
    footer: "You get this because you joined the session.",
  });
}

export function sessionChangedMessage(o: { name: string; title: string; when: string; callUrl: string | null; url: string; cancelled: boolean; reason?: string | null }) {
  return message({
    subject: o.cancelled ? `Cancelled: ${o.title}` : `Changed: ${o.title}`,
    name: o.name,
    lines: o.cancelled
      ? [`"${o.title}" (${o.when}) was cancelled${o.reason ? `: ${o.reason}` : "."}`, "The attached file removes it from your calendar."]
      : [`"${o.title}" changed. It is now ${o.when} (Accra time).`, ...(o.callUrl ? [`Call link: ${o.callUrl}`] : []), "The attached file updates your calendar."],
    button: { label: "See the session", url: o.url },
    footer: "You get this because you joined the session.",
  });
}

/** Phase 31: a member asks someone to mentor them. */
export function mentorRequestMessage(o: { name: string; mentee: string; goal: string; url: string }) {
  return message({
    subject: `${o.mentee} would like you to mentor them`,
    name: o.name,
    lines: [`${o.mentee} asked you to mentor them in the community.`, `What they want help with: "${o.goal}"`, "Accept or decline on your Mentoring page. If you accept, you both see each other's email to arrange how you meet."],
    button: { label: "Answer the request", url: o.url },
    footer: "You get this email because you're open to mentoring. Turn it off on your Mentoring page.",
  });
}

/** Phase 31: the mentor's answer. */
export function mentorAnswerMessage(o: { name: string; mentor: string; accepted: boolean; note: string | null; mentorEmail: string | null; url: string }) {
  return message({
    subject: o.accepted ? `${o.mentor} will mentor you` : `${o.mentor} can't mentor you right now`,
    name: o.name,
    lines: o.accepted
      ? [`Good news: ${o.mentor} accepted your mentoring request.`, ...(o.note ? [`Their note: "${o.note}"`] : []), `Write to them at ${o.mentorEmail} to agree how and when you meet.`]
      : [`${o.mentor} can't take you on right now.`, ...(o.note ? [`Their note: "${o.note}"`] : []), "Try another mentor: the list shows who has space."],
    button: { label: o.accepted ? "See your mentorship" : "Find another mentor", url: o.url },
    footer: "You get this email because you asked for a mentor in the community.",
  });
}
