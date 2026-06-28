/**
 * Text cleaning for TTS — port of Restate's `_tts_clean_text` (§4.1 of the
 * port spec). Strips markdown so MiniMax doesn't read out "#", "*", "[]()",
 * and enforces a 10k-char cap (~5 min of audio; guards against feeding a book).
 *
 * Throws on empty-after-clean or over-cap so callers can surface a clear error.
 */

const MAX_CHARS = 10_000;

export function cleanTtsText(input: string): string {
  let text = input ?? "";

  // 1. front-matter: if the text has a `\n---\n` divider, keep the body after it.
  const fm = text.split(/\n---\n/);
  if (fm.length > 1) text = fm.slice(1).join("\n---\n");

  // 2. strip markdown line-leaders + inline marks (otherwise they get spoken).
  text = text
    .replace(/^#{1,6}\s*/gm, "")          // headings
    .replace(/^>\s?/gm, "")               // blockquotes
    .replace(/^[-*]\s+/gm, "")            // list bullets
    .replace(/\*\*([^*]+)\*\*/g, "$1")    // bold
    .replace(/\*([^*]+)\*/g, "$1")        // italic
    .replace(/`([^`]+)`/g, "$1")          // inline code
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → label

  text = text.trim();

  if (!text) throw new Error("TTS 文本清洗后为空(可能整段都是 markdown 标记)。");
  if (text.length > MAX_CHARS) {
    throw new Error(`TTS 文本 ${text.length} 字,超过 ${MAX_CHARS} 字上限(约 5 分钟音频)。请分段。`);
  }
  return text;
}
