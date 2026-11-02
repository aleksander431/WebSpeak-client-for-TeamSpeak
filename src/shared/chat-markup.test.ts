import assert from "node:assert/strict";
import test from "node:test";
import { chatMessageBytes, chatPlainText, chatReplyPrefix, parseChatMarkup } from "./chat-markup.js";

test("fenced code keeps its text verbatim, with the language", () => {
  const { blocks } = parseChatMarkup("look:\n```ts\nconst a = **b** * c; // `x` https://e.com\n```\nok");
  assert.deepEqual(blocks.map(block => block.kind), ["paragraph", "code", "paragraph"]);
  assert.deepEqual(blocks[1], { kind: "code", language: "ts", code: "const a = **b** * c; // `x` https://e.com" });
});

test("an unclosed fence is ordinary text", () => {
  const { blocks } = parseChatMarkup("```js\nnot closed");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
});

test("inline code, emphasis, BBCode and links", () => {
  const { blocks } = parseChatMarkup("run `npm *ci*` then **build** and *wait* ~~no~~ [b]bold[/b] [color=red]red[/color] https://example.com/x");
  assert.equal(blocks[0].kind, "paragraph");
  const inlines = blocks[0].kind === "paragraph" ? blocks[0].inlines : [];
  assert.deepEqual(inlines.filter(inline => inline.kind !== "text").map(inline => inline.kind), ["code", "strong", "em", "strike", "strong", "link"]);
  assert.deepEqual(inlines[1], { kind: "code", text: "npm *ci*" });
  assert.ok(!JSON.stringify(inlines).includes("[color"), "colour tags are dropped, their text kept");
});

test("single asterisks in arithmetic and snake_case are not emphasis", () => {
  const { blocks } = parseChatMarkup("2 * 3 * 4 and my_var_name");
  assert.deepEqual(blocks[0], { kind: "paragraph", inlines: [{ kind: "text", text: "2 * 3 * 4 and my_var_name" }] });
});

test("javascript: links are never links", () => {
  const { blocks } = parseChatMarkup("[url=javascript:alert(1)]x[/url]");
  assert.ok(!JSON.stringify(blocks).includes("\"link\""));
});

test("a reply quote is recognized only at the start", () => {
  const reply = `${chatReplyPrefix("Alice", "**Hello** there, this is a `long` message")}sure`;
  assert.equal(reply, "> Alice: Hello there, this is a long message\nsure");
  const { blocks } = parseChatMarkup(reply);
  assert.deepEqual(blocks[0], { kind: "quote", author: "Alice", text: "Hello there, this is a long message" });
  assert.equal(blocks[1].kind, "paragraph");
  assert.equal(parseChatMarkup("hi\n> not a quote").blocks.length, 1);
});

test("reply excerpts are bounded and single-line", () => {
  const prefix = chatReplyPrefix("Bob:\nX", `${"word ".repeat(40)}\nsecond`);
  assert.equal(prefix.split("\n").length, 2);
  assert.ok(Array.from(prefix).length < 100);
  assert.ok(prefix.startsWith("> Bob  X: "));
});

test("mentions match known names, longest first, and flag the reader", () => {
  const { blocks, mentionsSelf } = parseChatMarkup("@Sasha Pro and @sasha, mail a@sasha.ru", { mentionNames: ["Sasha", "Sasha Pro", "Ivan"], selfName: "sasha" });
  const inlines = blocks[0].kind === "paragraph" ? blocks[0].inlines : [];
  assert.deepEqual(inlines.filter(inline => inline.kind === "mention"), [
    { kind: "mention", name: "Sasha Pro", self: false },
    { kind: "mention", name: "Sasha", self: true },
  ]);
  assert.equal(mentionsSelf, true);
  assert.equal(parseChatMarkup("@Ivanov", { mentionNames: ["Ivan"], selfName: "ivan" }).mentionsSelf, false);
});

test("plain text and byte budget", () => {
  assert.equal(chatPlainText("> A: q\n**x** `y`\n```\nz\n```"), "x y\nz");
  assert.equal(chatMessageBytes("ж"), 2);
});
