import assert from "node:assert/strict";
import { buildCommitSearchGitLogArgs, isCommitSearchQuery, parseCommitSearchQuery } from "../src/shared/commit-history-search.js";

const parsed = parseCommitSearchQuery('commit author:pat after:2026-04-01 before:2026-05-01 branch:main path:src/app.ts "fix button"');
assert.deepEqual(parsed, {
  message: "fix button",
  author: "pat",
  after: "2026-04-01",
  before: "2026-05-01",
  ref: "main",
  path: "src/app.ts",
  limit: 50,
  timeoutMs: 12000
});

const shaSearch = parseCommitSearchQuery("commit deadbee");
assert.equal(shaSearch.sha, "deadbee");
assert.equal(isCommitSearchQuery("commit author:pat"), true);
assert.equal(isCommitSearchQuery("author:pat"), true);
assert.equal(isCommitSearchQuery("plain repo search"), false);

const incompleteQualifier = parseCommitSearchQuery("author:");
assert.equal(incompleteQualifier.message, undefined);
assert.equal(incompleteQualifier.author, undefined);

const quotedQualifier = parseCommitSearchQuery('author:"Adam Weidman" path:"src/app shell.ts"');
assert.equal(quotedQualifier.author, "Adam Weidman");
assert.equal(quotedQualifier.path, "src/app shell.ts");

const slashDateQualifier = parseCommitSearchQuery("after:1/12/26 before:12/31/2026");
assert.equal(slashDateQualifier.after, "2026-01-12");
assert.equal(slashDateQualifier.before, "2026-12-31");

const args = buildCommitSearchGitLogArgs(parsed);
assert.deepEqual(args.slice(0, 4), ["log", "--date=iso-strict", "--max-count=50", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"]);
assert.ok(args.includes("--regexp-ignore-case"));
assert.ok(args.includes("--grep=fix button"));
assert.ok(args.includes("--author=pat"));
assert.ok(args.includes("--since=2026-04-01"));
assert.ok(args.includes("--until=2026-05-01"));
assert.ok(args.includes("main"));
assert.deepEqual(args.slice(-2), ["--", "src/app.ts"]);

const cleaned = parseCommitSearchQuery("commit branch:--bad path:../secret limit:9999 timeoutMs:1");
assert.equal(cleaned.ref, undefined);
assert.equal(cleaned.path, undefined);
assert.equal(cleaned.limit, 200);
assert.equal(cleaned.timeoutMs, 12000);

console.log("Commit history search parser tests ok");
