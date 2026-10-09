// Phase 41: trust & safety. Reads what members write (jobs, chat, articles, profiles...) for the
// signs of the scams common in Ghana's tech scene: asking applicants to pay, asking for a Mobile
// Money PIN or ID card, "investment" schemes, moving people off the platform, and links that hide
// where they go or pretend to be a well-known site. It only scores; people decide (src/modules/safety).

export type RiskSignal = { key: string; label: string; weight: number; match?: string };

type Rule = { key: string; label: string; weight: number; pattern: RegExp };

const RULES: Rule[] = [
  {
    key: "fee",
    label: "Asks people to pay (fee, deposit or charge)",
    weight: 50,
    pattern: /\b(registration|application|processing|training|onboarding|starter|activation|joining|form|medical|uniform|admin(?:istrative)?)\s+(fee|charge|cost)s?\b|\bpay\s+(?:a\s+|the\s+)?(fee|deposit|small amount|token)\b|\b(refundable|commitment)\s+(fee|deposit)\b|\bpay\s+(?:before|to)\s+(?:you\s+)?(apply|start|join|begin|get)\b/i,
  },
  {
    key: "credentials",
    label: "Asks for a PIN, code, password or ID",
    weight: 50,
    pattern: /\b(momo|mobile money|wallet|atm|bank)\s*pin\b|\b(otp|verification code|one[- ]time (?:pass)?code)\b|\bsend\s+(?:me\s+|us\s+)?(?:your\s+)?(password|pin|ghana\s*card|id card|passport|bvn)\b|\b(ghana\s*card|national id)\s+(number|photo|picture|copy)\b/i,
  },
  {
    key: "investment",
    label: "Investment or quick-money scheme",
    weight: 40,
    pattern: /\b(double|triple)\s+your\s+(money|investment|cash)\b|\bguaranteed\s+(profit|returns?|income)\b|\b(forex|binary options?|crypto(?:currency)?)\s+(trading|investment|signals?)\b|\binvest\s+(?:just\s+|only\s+)?(?:gh[s₵]|¢|\$)\s?\d|\bearn\s+(?:gh[s₵]|¢|\$)\s?\d[\d,]*\s*(?:daily|per day|a day|weekly)\b|\bwork from home and earn\b/i,
  },
  {
    key: "offplatform",
    label: "Moves people off the platform (WhatsApp, Telegram, phone)",
    weight: 15,
    pattern: /\b(whatsapp|telegram|signal)\s+(me|us|only|number)\b|\b(dm|inbox|text|call)\s+me\s+on\s+(whatsapp|telegram)\b|(?:\+233|\b0)\s?[235]\d(?:[\s-]?\d){7}\b/i,
  },
  {
    key: "urgency",
    label: "Pressure to act now",
    weight: 10,
    pattern: /\b(limited slots?|only \d+ slots?|act now|urgent(?:ly)? (?:needed|hiring)|first come,? first served|today only|before it'?s too late)\b/i,
  },
];

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "cutt.ly", "is.gd", "rb.gy", "shorturl.at", "ow.ly", "buff.ly", "tiny.cc", "rebrand.ly", "s.id", "goo.su", "t.ly", "shrtco.de", "bl.ink"]);
const BRANDS = ["microsoft", "google", "paypal", "github", "facebook", "whatsapp", "instagram", "apple", "amazon", "netflix", "linkedin", "binance", "mtn", "vodafone", "telecel", "airteltigo", "ecobank", "absa", "stanbic", "gcb", "fidelity", "zeepay", "hubtel", "paystack", "flutterwave", "agod"];

/** Undoes the usual look-alike swaps (rn→m, 0→o, 1→l, vv→w...) so "rnicr0soft" reads "microsoft". */
const unconfuse = (s: string) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1|]/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/@/g, "a");

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

export function linksIn(text: string): string[] {
  return [...new Set((text.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))].slice(0, 50);
}

/** What is suspicious about one link, if anything. */
export function linkSignals(raw: string): RiskSignal[] {
  let url: URL;
  try {
    url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
  } catch {
    return [];
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const out: RiskSignal[] = [];
  if (SHORTENERS.has(host)) out.push({ key: "shortener", label: "Shortened link that hides where it goes", weight: 25, match: host });
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) out.push({ key: "ip-link", label: "Link to a bare IP address", weight: 30, match: host });
  if (host.split(".").some((part) => part.startsWith("xn--"))) out.push({ key: "punycode", label: "Link with disguised letters (punycode)", weight: 35, match: host });
  // A brand name in the address that isn't the brand's own site: "paypal-login.top", "rnicrosoft.com".
  const labels = host.split(".");
  const registered = labels.slice(-2).join(".");
  const plain = unconfuse(labels.slice(0, -1).join("."));
  const brand = BRANDS.find((b) => plain.includes(b));
  if (brand && registered !== `${brand}.com` && registered !== `${brand}.com.gh` && !host.endsWith(`.${brand}.com`) && !(registered === "com.gh" && labels.at(-3) === brand)) {
    const officialLooking = labels.slice(0, -1).join(".") !== plain || /login|verify|secure|account|support|update|wallet|bonus|promo/.test(host);
    out.push({ key: "lookalike", label: `Address pretends to be ${brand}`, weight: officialLooking ? 45 : 25, match: host });
  }
  if (url.protocol === "http:") out.push({ key: "insecure-link", label: "Link without https", weight: 5, match: host });
  return out;
}

export type RiskResult = { score: number; signals: RiskSignal[]; links: string[] };

/** Scores a piece of text (0 = nothing found); each kind of signal counts once. */
export function scanText(text: string): RiskResult {
  const signals: RiskSignal[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) signals.push({ key: rule.key, label: rule.label, weight: rule.weight, match: m[0].slice(0, 80) });
  }
  const links = linksIn(text);
  for (const l of links) for (const s of linkSignals(l)) if (!signals.some((x) => x.key === s.key)) signals.push(s);
  return { score: Math.min(100, signals.reduce((n, s) => n + s.weight, 0)), signals, links };
}

/** At or above this a job waits for a staff check before it is listed. */
export const HOLD_SCORE = 40;
/** At or above this something goes into the staff risk queue. */
export const FLAG_SCORE = 25;
