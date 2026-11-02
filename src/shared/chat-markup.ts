// Chat message markup: a small, safe subset of Markdown plus the BBCode that
// native TeamSpeak clients send. The result is a tree the page renders with
// ordinary elements; nothing here produces HTML.
//
//   ```lang            fenced code block (language optional)
//   `code`             inline code
//   **bold** *italic* ~~strike~~ and [b] [i] [u] [s]
//   > Name: excerpt    a reply quote, only as the first line(s) of a message
//   @Name              a mention of someone the caller knows by name
//
// Links keep the rules of parseChatMessage (http/https only, [url] BBCode).

import { parseChatMessage } from "./chat-storage.js";

export type ChatInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "mention"; name: string; self: boolean }
  | { kind: "strong" | "em" | "strike" | "underline"; children: ChatInline[] };

export type ChatBlock =
  | { kind: "paragraph"; inlines: ChatInline[] }
  | { kind: "code"; language: string; code: string }
  | { kind: "quote"; author: string; text: string };

export interface ChatMarkupOptions {
  /** Nicknames that `@Name` may refer to (longest match wins). */
  mentionNames?: readonly string[];
  /** The reader's own nickname: a mention of it is marked `self`. */
  selfName?: string;
}

export interface ChatMarkup {
  blocks: ChatBlock[];
  /** The message mentions the reader (`@selfName`). */
  mentionsSelf: boolean;
}

/** TeamSpeak keeps text messages short; this is the budget in UTF-8 bytes. */
export const CHAT_MESSAGE_MAX_BYTES = 1000;
/** Characters a reply quote keeps of the message it answers. */
export const CHAT_REPLY_EXCERPT_LENGTH = 80;

const FENCE = /^```([A-Za-z0-9_+#.-]{0,24})[ \t]*$/;
const MAX_NESTING = 4;

export function chatMessageBytes(message: string): number {
  return new TextEncoder().encode(message).length;
}

/** The first line(s) of a reply: `> Name: excerpt`, readable in any TeamSpeak client. */
export function chatReplyPrefix(author: string, message: string): string {
  const plain = chatPlainText(message).replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  const excerpt = chars.length > CHAT_REPLY_EXCERPT_LENGTH ? `${chars.slice(0, CHAT_REPLY_EXCERPT_LENGTH - 1).join("")}…` : plain;
  const name = author.replace(/[\r\n:]/g, " ").trim() || "?";
  return `> ${name}: ${excerpt}\n`;
}

/** Text without markup, for excerpts, search and notifications. */
export function chatPlainText(message: string): string {
  const { blocks } = parseChatMarkup(message);
  return blocks.map(block => {
    if (block.kind === "code") return block.code;
    if (block.kind === "quote") return "";
    return inlineText(block.inlines);
  }).filter(Boolean).join("\n");
}

function inlineText(inlines: readonly ChatInline[]): string {
  return inlines.map(inline => {
    switch (inline.kind) {
      case "text": case "code": return inline.text;
      case "link": return inline.text;
      case "mention": return `@${inline.name}`;
      default: return inlineText(inline.children);
    }
  }).join("");
}

export function parseChatMarkup(message: string, options: ChatMarkupOptions = {}): ChatMarkup {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ChatBlock[] = [];
  const state = { mentionsSelf: false };
  const names = [...new Set((options.mentionNames ?? []).map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const selfName = options.selfName?.trim().toLowerCase() ?? "";
  const context: InlineContext = { names, selfName, state };

  let index = 0;
  // A reply quote is only recognized at the very start of the message.
  while (index < lines.length) {
    const match = /^>\s?(.*)$/.exec(lines[index]);
    if (!match) break;
    const body = match[1];
    const colon = body.indexOf(": ");
    const author = colon > 0 && colon <= 64 ? body.slice(0, colon).trim() : "";
    const text = author ? body.slice(colon + 2) : body;
    const previous = blocks.at(-1);
    if (previous?.kind === "quote" && !author) previous.text += `\n${text}`;
    else blocks.push({ kind: "quote", author, text });
    index += 1;
  }

  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n");
    paragraph = [];
    if (!text.trim()) return;
    blocks.push({ kind: "paragraph", inlines: parseInlines(text, context, 0) });
  };
  for (; index < lines.length; index += 1) {
    const fence = FENCE.exec(lines[index].trim());
    if (!fence) { paragraph.push(lines[index]); continue; }
    // An opening fence without a closing one is ordinary text.
    const close = lines.findIndex((line, at) => at > index && line.trim() === "```");
    if (close < 0) { paragraph.push(lines[index]); continue; }
    flush();
    blocks.push({ kind: "code", language: fence[1].toLowerCase(), code: lines.slice(index + 1, close).join("\n") });
    index = close;
  }
  flush();
  // A message that is only a quote still shows its quote.
  return { blocks, mentionsSelf: state.mentionsSelf };
}

interface InlineContext {
  names: string[];
  selfName: string;
  state: { mentionsSelf: boolean };
}

function parseInlines(text: string, context: InlineContext, depth: number): ChatInline[] {
  const result: ChatInline[] = [];
  // Inline code first: nothing inside it is markup.
  const pattern = /`([^`\n]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) result.push(...parseLinks(text.slice(last, at), context, depth));
    result.push({ kind: "code", text: match[1] });
    last = at + match[0].length;
  }
  if (last < text.length) result.push(...parseLinks(text.slice(last), context, depth));
  return result;
}

function parseLinks(text: string, context: InlineContext, depth: number): ChatInline[] {
  const result: ChatInline[] = [];
  for (const part of parseChatMessage(text)) {
    if (part.kind === "link") result.push({ kind: "link", href: part.href, text: part.text });
    else result.push(...parseEmphasis(part.text, context, depth));
  }
  return result;
}

const EMPHASIS: { pattern: RegExp; kind: "strong" | "em" | "strike" | "underline" }[] = [
  { pattern: /\[b\]([\s\S]+?)\[\/b\]/i, kind: "strong" },
  { pattern: /\[i\]([\s\S]+?)\[\/i\]/i, kind: "em" },
  { pattern: /\[u\]([\s\S]+?)\[\/u\]/i, kind: "underline" },
  { pattern: /\[s\]([\s\S]+?)\[\/s\]/i, kind: "strike" },
  { pattern: /\*\*(?=\S)([\s\S]*?\S)\*\*/, kind: "strong" },
  { pattern: /~~(?=\S)([\s\S]*?\S)~~/, kind: "strike" },
  // Single asterisks only around words, so "2 * 3 * 4" stays arithmetic.
  { pattern: /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/, kind: "em" },
];

function parseEmphasis(text: string, context: InlineContext, depth: number): ChatInline[] {
  if (!text) return [];
  if (depth < MAX_NESTING) {
    let best: { index: number; length: number; inner: string; kind: ChatInline["kind"] } | null = null;
    for (const { pattern, kind } of EMPHASIS) {
      const match = pattern.exec(text);
      if (match && (best === null || match.index < best.index)) best = { index: match.index, length: match[0].length, inner: match[1], kind };
    }
    if (best) {
      return [
        ...parseMentions(stripBbcode(text.slice(0, best.index)), context),
        { kind: best.kind as "strong", children: parseEmphasis(best.inner, context, depth + 1) },
        ...parseEmphasis(text.slice(best.index + best.length), context, depth),
      ];
    }
  }
  return parseMentions(stripBbcode(text), context);
}

/** TeamSpeak colour/size tags carry no meaning here; keep their text. */
function stripBbcode(text: string): string {
  return text.replace(/\[\/?(?:color|size|left|center|right|img)(?:=[^\]]*)?\]/gi, "");
}

function parseMentions(text: string, context: InlineContext): ChatInline[] {
  if (!text) return [];
  if (!context.names.length || !text.includes("@")) return [{ kind: "text", text }];
  const result: ChatInline[] = [];
  let buffer = "";
  let index = 0;
  const lower = text.toLowerCase();
  while (index < text.length) {
    const before = index === 0 ? "" : text[index - 1];
    if (text[index] === "@" && !/[\w@.]/.test(before)) {
      const name = context.names.find(candidate => {
        if (!lower.startsWith(candidate.toLowerCase(), index + 1)) return false;
        const after = text[index + 1 + candidate.length] ?? "";
        return !/[\p{L}\p{N}_]/u.test(after);
      });
      if (name) {
        if (buffer) { result.push({ kind: "text", text: buffer }); buffer = ""; }
        const self = Boolean(context.selfName) && name.toLowerCase() === context.selfName;
        if (self) context.state.mentionsSelf = true;
        result.push({ kind: "mention", name, self });
        index += 1 + name.length;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  if (buffer) result.push({ kind: "text", text: buffer });
  return result;
}
