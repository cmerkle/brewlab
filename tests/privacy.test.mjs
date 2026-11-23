// This repo is public: tracked files must not contain known personal terms (a maintainer's
// addresses, hosts, email, coffee history…). The terms themselves are private, so only their
// SHA-256 hashes are listed here. Every word, and every two- and three-word phrase, of every
// tracked text file is hashed and checked. Regenerate the list with:
//   node tests/privacy.test.mjs --hash < terms.txt
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const norm = (s) => s.toLowerCase().replace(/^[^a-z0-9&]+|[^a-z0-9&]+$/g, "");

if (process.argv.includes("--hash")) {
  const terms = fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  console.log(JSON.stringify(terms.map((t) => sha(t.toLowerCase().split(/\s+/).map(norm).join(" "))), null, 2));
  process.exit(0);
}

const DENY = new Set([
  "1f97c952c63037c4df60ab43d99d8018031d2a83b396073dc75d6add191a7e41",
  "29e34a645599b3c1cefce3a8298b1a8829acf737440435ebcfe6bb3250e8f5d8",
  "1effd848511ba30a25b6489b8988c1aac7c558f2cae7e51e7396bdc0636c961f",
  "cfc311df8c2b096e75f7c59b9b2b6c885f51b2fb70a66b38cee93cf7b4741261",
  "42f9c87054fa0806e5005224616c8c6e96d7721b77dcbec6d8cd1a5d7baffff2",
  "a32a707962d725e7ecdc6ef718a15612781d2525662b6b3a9aacf63954e3c81d",
  "b08ff8d42f339748eb96792bab5458a2a77073ae8ff6423926f3c3c1a4319fdf",
  "33e90563f9fe47a96c79d10bae693a602fb17bee2c46731ef0b5e25bd3914cfb",
  "876496c704ea0da738b684b1eb19dff3407f2578cadad7dc59e67a15cff21847",
  "487f015d89c60191eeb7ebf3f24f9e55e0ad75b79fe34da402f2ab0108967648",
  "7cf55690b5965aee011f32bb071a0a1847cfbe7f9580c9c0e08d3e36a6b78e00",
  "d5a59973dd52c4689ae691dda9a884fed49411b2a4f4f61205ca4ea9fb94ad98",
  "42f5c5b9f5f9bfc186dda3e0328d741c72b4bd0e57dc612e3291f0dae67f2d82",
  "85e37e63ea85b5be69d86d4712a3c4486147276470307a1667ffb2dba3b0080b",
  "4016c3db3bc3c731a4148022f43ebd6d4422b77976763135b9d9afcb9b71b2c1",
]);

/** Candidate strings in a line: words (and their @ / : pieces) plus 2- and 3-word phrases. */
function candidates(line) {
  const words = line.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    out.add(w);
    for (const part of w.split(/[\/@:]+/)) if (part) out.add(norm(part));
    if (w.includes("@")) out.add(w.slice(w.lastIndexOf("/") + 1));
    if (words[i + 1]) out.add(`${w} ${words[i + 1]}`);
    if (words[i + 2]) out.add(`${w} ${words[i + 1]} ${words[i + 2]}`);
  });
  return out;
}

test("no known personal terms in tracked files", () => {
  let files;
  try {
    files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch {
    return; // not a git checkout (e.g. inside the Docker build) — nothing to check
  }
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) continue; // binary
    buf.toString("utf8").split("\n").forEach((line, i) => {
      for (const c of candidates(line)) if (DENY.has(sha(c))) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], "personal data in tracked files — remove it (the term list is private)");
});
