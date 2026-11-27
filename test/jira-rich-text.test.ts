import assert from "node:assert/strict";
import { test } from "node:test";
import { richTextToString, textToAdf } from "../src/jira-rich-text.js";

test("plain-text ADF conversion preserves empty lines, CRLF and empty content", () => {
  assert.equal(richTextToString(textToAdf("first\r\n\r\nlast")), "first\n\nlast");
  assert.equal(richTextToString(textToAdf("")), "");
  assert.equal(richTextToString(null), null);
  assert.equal(richTextToString(undefined), null);
  assert.equal(richTextToString("Plain string"), "Plain string");
});

test("ADF display handles formatted text, lists, mentions, line breaks and cards", () => {
  assert.equal(richTextToString({
    type: "doc", version: 1, content: [
      { type: "paragraph", content: [{ type: "text", text: "Hello ", marks: [{ type: "strong" }] },
        { type: "mention", attrs: { text: "@User" } }, { type: "hardBreak" },
        { type: "emoji", attrs: { shortName: ":smile:" } }] },
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
      ] },
      { type: "paragraph", content: [{ type: "inlineCard", attrs: { url: "https://example.com" } }] },
    ],
  }), "Hello @User\n:smile:\nOne\nTwo\nhttps://example.com");
});
