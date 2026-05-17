import assert from "node:assert/strict";
import {
  emptyPullRequestReviewDraft,
  reviewSubmitPayload,
  reviewSubmitState,
  upsertReviewDraftComment
} from "../src/shared/pr-review-drafts.js";

const draft = {
  ...emptyPullRequestReviewDraft({ repoId: "octo-repo", prNumber: 9, headSha: "head-a" }),
  body: "Looks good overall.",
  event: "APPROVE" as const,
  comments: upsertReviewDraftComment([], {
    id: "draft-1",
    fileId: "src/app.ts",
    path: "src/app.ts",
    body: "Nice cleanup.",
    line: 20,
    side: "RIGHT",
    diffSide: "additions"
  })
};

assert.equal(reviewSubmitState({ draft, connected: true, online: true, canWrite: true }).canSubmit, true);
assert.deepEqual(reviewSubmitPayload(draft), {
  event: "APPROVE",
  body: "Looks good overall.",
  comments: [{ path: "src/app.ts", body: "Nice cleanup.", line: 20, side: "RIGHT" }]
});

assert.match(reviewSubmitState({ draft, connected: false, online: true, canWrite: true }).message, /Connect GitHub/);
assert.match(reviewSubmitState({ draft, connected: true, online: false, canWrite: true }).message, /Offline/);
assert.equal(reviewSubmitState({ draft, connected: true, online: false, queueWhenUnavailable: true, canWrite: true }).canSubmit, true);
assert.match(
  reviewSubmitState({ draft, connected: true, online: false, queueWhenUnavailable: true, canWrite: true }).message,
  /queued locally/
);
assert.match(reviewSubmitState({ draft, connected: true, online: true, canWrite: false }).message, /cannot write reviews/);
assert.match(
  reviewSubmitState({
    draft,
    connected: true,
    online: true,
    canWrite: false,
    writeBlockReason: "This account has read-only access to this repository."
  }).message,
  /read-only access/
);

const emptyComment = emptyPullRequestReviewDraft({ repoId: "octo-repo", prNumber: 9, headSha: "head-a" });
assert.equal(reviewSubmitState({ draft: emptyComment, connected: true, online: true, canWrite: true }).canSubmit, false);
assert.match(
  reviewSubmitState({ draft: { ...emptyComment, outdated: true }, connected: true, online: true, canWrite: true }).message,
  /older PR head/
);

console.log("PR review polish UI tests ok");
