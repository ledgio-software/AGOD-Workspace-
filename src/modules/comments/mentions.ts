// @mentions in comments: "@Ama Mensah" (full name) or "@ama" (the part of the email before @).
// Only people involved in the project can be mentioned, so a name never reaches an outsider.

export type Mentionable = { id: string; name: string; email: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findMentions(body: string, people: Mentionable[]): string[] {
  const found = new Set<string>();
  // Longest names first, so "@Ama Mensah" is not also read as "@Ama".
  const candidates = people.flatMap((p) => [
    { id: p.id, token: p.name.trim() },
    { id: p.id, token: p.email.split("@")[0] },
  ]);
  candidates.sort((a, b) => b.token.length - a.token.length);
  let rest = body;
  for (const { id, token } of candidates) {
    if (token.length < 2) continue;
    const pattern = new RegExp(`@${escape(token)}(?![\\p{L}\\p{N}._-])`, "giu");
    if (pattern.test(rest)) {
      found.add(id);
      rest = rest.replace(pattern, " ");
    }
  }
  return [...found];
}
