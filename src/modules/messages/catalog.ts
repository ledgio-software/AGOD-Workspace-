// Phase 34: the built-in stickers, the emojis offered in the message box, and the reactions.
// Plain data (no server code), so the message box can use it too.

export const STICKERS = {
  akwaaba: { emoji: "🤗", label: "Akwaaba!" },
  ayekoo: { emoji: "👏", label: "Ayekoo!" },
  medaase: { emoji: "🙏", label: "Medaase" },
  chale: { emoji: "😎", label: "Chale!" },
  ei: { emoji: "😲", label: "Ei!" },
  sorry: { emoji: "😅", label: "Sorry o" },
  onit: { emoji: "💪", label: "On it" },
  shipped: { emoji: "🚀", label: "Shipped!" },
  lgtm: { emoji: "✅", label: "Looks good" },
  bug: { emoji: "🐛", label: "Found a bug" },
  thinking: { emoji: "🤔", label: "Let me think" },
  coffee: { emoji: "☕", label: "Break time" },
  party: { emoji: "🎉", label: "Let's go!" },
  fire: { emoji: "🔥", label: "Fire!" },
  later: { emoji: "⏰", label: "Later today" },
  goodnight: { emoji: "🌙", label: "Good night" },
} as const;

export type StickerKey = keyof typeof STICKERS;
export const isSticker = (key: string): key is StickerKey => Object.hasOwn(STICKERS, key);

/** Emojis offered in the message box (any emoji can still be typed or pasted). */
export const EMOJIS = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤔", "😅", "😮", "😢", "😡",
  "🙏", "👏", "👍", "👎", "👌", "✌️", "💪", "🙌", "🤝", "👀", "💯", "🔥",
  "🎉", "🚀", "✅", "❌", "⚠️", "💡", "🐛", "☕", "🍲", "⚽", "🇬🇭", "❤️",
] as const;

/** Reactions people can put on a message. */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "🔥", "✅"] as const;
export const isReaction = (emoji: string) => (REACTIONS as readonly string[]).includes(emoji);

/** Voice notes: at most two minutes. */
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
