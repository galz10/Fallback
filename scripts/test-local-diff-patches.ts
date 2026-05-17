import assert from "node:assert/strict";
import { hunkPatch, parseLocalPatch, selectedLinesPatch } from "../src/shared/local-diff-patches.js";

const patch = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 one
-two
+two changed
+three
 four
-five
+five changed
`;

const [file] = parseLocalPatch(patch);
assert.equal(file?.path, "src/example.ts");
assert.equal(file?.hunks.length, 1);
assert.equal(file?.hunks[0]?.changedLines.length, 5);
assert.equal(file?.isGenerated, false);

const hunk = file!.hunks[0]!;
const wholeHunk = hunkPatch(file!, hunk.id);
assert.match(wholeHunk ?? "", /@@ -1,4 \+1,5 @@/);
assert.match(wholeHunk ?? "", /\+three/);

const addition = hunk.changedLines.find((line) => line.type === "addition" && line.content === "three")!;
const linePatch = selectedLinesPatch(file!, [addition.id]);
assert.match(linePatch ?? "", /@@ -1,4 \+1,5 @@/);
assert.match(linePatch ?? "", /\+three/);
assert.doesNotMatch(linePatch ?? "", /\+two changed/);
assert.match(linePatch ?? "", / two$/m);
assert.match(linePatch ?? "", / five$/m);

const reverseLinePatch = selectedLinesPatch(
  file!,
  hunk.changedLines.filter((line) => line.content === "two" || line.content === "two changed").map((line) => line.id),
  { applyMode: "reverse" }
);
assert.match(reverseLinePatch ?? "", / five changed$/m);
assert.doesNotMatch(reverseLinePatch ?? "", /^ five$/m);

const generated = parseLocalPatch(`diff --git a/dist/app.min.js b/dist/app.min.js
index 1111111..2222222 100644
--- a/dist/app.min.js
+++ b/dist/app.min.js
@@ -1 +1 @@
-old
+new
`);
assert.equal(generated[0]?.isGenerated, true);

const adjacent = parseLocalPatch(`diff --git a/src/adjacent.ts b/src/adjacent.ts
index 1111111..2222222 100644
--- a/src/adjacent.ts
+++ b/src/adjacent.ts
@@ -1,3 +1,3 @@
 one
-two
+two changed
 three
@@ -7,3 +7,3 @@
 seven
-eight
+eight changed
 nine
`);
assert.equal(adjacent[0]?.hunks.length, 2);
assert.match(hunkPatch(adjacent[0]!, adjacent[0]!.hunks[1]!.id) ?? "", /eight changed/);

const sameLine = parseLocalPatch(`diff --git a/src/same.ts b/src/same.ts
index 1111111..2222222 100644
--- a/src/same.ts
+++ b/src/same.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
`)[0]!;
const sameLinePatch = selectedLinesPatch(
  sameLine,
  sameLine.hunks[0]!.changedLines.filter((line) => line.content === "two" || line.content === "TWO").map((line) => line.id)
);
assert.match(sameLinePatch ?? "", /-two/);
assert.match(sameLinePatch ?? "", /\+TWO/);

const crlf = parseLocalPatch(
  "diff --git a/src/crlf.txt b/src/crlf.txt\r\nindex 1111111..2222222 100644\r\n--- a/src/crlf.txt\r\n+++ b/src/crlf.txt\r\n@@ -1,2 +1,2 @@\r\n one\r\n-old\r\n+new\r\n"
)[0]!;
assert.equal(crlf.hunks[0]?.changedLines.length, 2);
assert.doesNotMatch(hunkPatch(crlf, crlf.hunks[0]!.id) ?? "", /\r/);

const renamed = parseLocalPatch(`diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 89%
rename from src/old-name.ts
rename to src/new-name.ts
index 1111111..2222222 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1 +1 @@
-old name
+new name
`)[0]!;
assert.equal(renamed.previousPath, "src/old-name.ts");
assert.equal(renamed.path, "src/new-name.ts");

const binary = parseLocalPatch(`diff --git a/assets/image.png b/assets/image.png
index 1111111..2222222 100644
Binary files a/assets/image.png and b/assets/image.png differ
`)[0]!;
assert.equal(binary.isBinary, true);
assert.equal(binary.isImage, true);
assert.equal(binary.hunks.length, 0);

const largePatch = parseLocalPatch(`diff --git a/src/large.txt b/src/large.txt
index 1111111..2222222 100644
--- a/src/large.txt
+++ b/src/large.txt
@@ -1 +1 @@
-small
+${"x".repeat(512_010)}
`)[0]!;
assert.equal(largePatch.isTooLarge, true);

console.log("Local diff patch helper tests ok");
