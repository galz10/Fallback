# Product Coherence Improvements Plan

## Goal

Turn Fallback's existing capabilities into a clearer daily product experience: the place where GitHub work, local changes, branch state, and recovery context stay coherent when repository work gets messy.

This is not a plan to rebuild Fallback as a generic Git client. The repo already has the hard substrate: local-first GitHub cache, My Work/attention signals, offline writeback, PR review drafts, local Git preflights, operation/recovery records, Branch Integrity, and workspaces/worktrees.

The work here is productization: stronger information hierarchy, clearer language, repeated safety patterns, and a few memorable workflows that make the app's value obvious in the first session.

## Product Thesis

Fallback should not be positioned as "GitHub Desktop, but more features."

Fallback should feel like:

> A local-first GitHub workbench that keeps repo work understandable, recoverable, and safe when GitHub context, local Git state, or branch history cannot be trusted to stay available, current, or clean.

## Current Strengths

- GitHub context is cached locally: PRs, issues, reviews, comments, checks, workflow runs, and commit status.
- My Work and notifications already derive attention signals across repositories.
- PR reviews have local drafts and queued writeback support.
- Offline action queue supports retry, cancel, edit, and recovery flows.
- Local Git operations have preflight state, conflict detection, operation records, and recovery metadata.
- Branch Integrity already models suspicious branch history and recovery plans.
- Workspaces/worktrees are first-class domain concepts.
- Multiple GitHub profiles/accounts are represented in the auth model.

## Product Gaps

- The app's strongest capabilities are visible, but not yet composed into one obvious daily loop.
- My Work can become a true cross-repo work queue, not just an attention list.
- Offline PR review can feel more like an indestructible local review document.
- Git safety flows should use one repeated UX pattern across pull, push, publish, stash, branch switch, discard, revert, and conflict recovery.
- Branch Integrity language is accurate but too internal for normal developers.
- Worktrees need a human product frame before they become an agent story.
- The public story should grow from "local-first GitHub continuity" to "local-first GitHub continuity plus safe local Git operations."

## Principles

- Improve clarity before adding surface area.
- Prefer plain-language explanations over Git internals unless the user asks for details.
- Keep the UI dense and operational, not explanatory or marketing-like.
- Every risky action should show state, risk, action, result, and recovery.
- Every attention item should explain why it exists, what changed, and what the next likely action is.
- Agent-related workflows should be framed as workspace safety and provenance, not AI novelty.

## Design Direction

All UI work in this plan should follow Fallback's existing Vercel and Linear-inspired design direction from `DESIGN.md`: dark-first, precise, dense, keyboard-native, and restrained. Treat this as a product constraint, not a visual garnish.

### Design Goals

- Calm density: show enough repository state to make decisions quickly without turning the screen into a wall of badges.
- Clear hierarchy: the work surface should dominate; chrome, metadata, and secondary actions should recede.
- Operational precision: status, risk, identity, branch, check, queue, and recovery signals should be compact and comparable.
- Earned attention: use color and stronger contrast only for user-blocking states, destructive actions, failed checks, active risk, and primary next actions.
- Command-first flow: every major surface should work with keyboard navigation, command palette actions, and predictable focus states.
- Structure over decoration: use alignment, spacing, subtle borders, tonal surfaces, and typography instead of gradients, oversized cards, or ornamental UI.
- Fast perceived performance: prefer progressive disclosure, lazy details, cached summaries, and stable layouts over loading-heavy pages.

### UI Rules

- Use the existing shell, sidebar, command palette, typography, icons, tokens, and component primitives before creating new UI patterns.
- Keep repeated work items compact and scannable; avoid hero sections, marketing blocks, and explanatory cards in operational views.
- Prefer split panes, lists, tabs, filters, status dots, small badges, command actions, and inline detail panels for dense workflows.
- Do not put cards inside cards. Use cards only for repeated items, modals, framed tools, and focused evidence/recovery panels.
- Text must survive long repo names, branch names, issue titles, paths, and reviewer names without overlap or layout shift.
- Every interactive control needs accessible names, visible focus, hover, active, disabled, loading, error, and destructive states where relevant.
- Error and warning copy must include the recovery path; do not stop at "failed" or "unknown."
- Keep motion purposeful and subtle: opacity/transform for cause and effect, no layout-affecting animation, and respect reduced motion.
- Use monospace for SHAs, branch names when appropriate, paths, keyboard shortcuts, operation ids, and comparable technical values.

## Initiative 1: Make My Work Exceptional

### Goal

Make My Work the best cross-repo GitHub inbox: quieter than GitHub notifications, more actionable than an issue list, and clear enough to be the default daily starting point.

### Target Behavior

Each item should answer:

- Why is this here?
- What changed since I last looked?
- What can I do next?

Example item summaries:

- `Review requested by Maya · 7 files changed · checks failing · saved draft`
- `Your PR is blocked · 2 requested changes · CI failed 14m ago`
- `Mentioned in issue · waiting on your answer · last human comment 2h ago`
- `Queued review blocked · token expired · reconnect account`

### Proposed Lanes

- `Needs me`: review requested, assigned issue, direct mention, failing check on my PR, blocked offline action, stale saved review.
- `Waiting`: PRs authored by me, review requested from others, issues where I asked a question.
- `At risk`: failing checks, stale review drafts, branch integrity findings, diverged local branches, blocked writebacks.
- `Snoozed`: temporarily hidden items with a clear reappear time.
- `Muted`: noisy items hidden until explicitly restored.

### Implementation Notes

- Extend attention derivation with reason codes, change summaries, and suggested actions.
- Preserve the current notification data model where possible; add product-facing explanation fields rather than duplicating raw GitHub entities.
- Add per-item affordances for open, snooze, mute, mark done, and jump to source entity.
- Make blocked offline actions and branch integrity incidents eligible for My Work when they require human intervention.
- Prefer concise generated strings from deterministic domain helpers over ad hoc renderer copy.
- Design the page as a Linear-style command inbox: lane tabs, dense rows, quiet metadata, strong selected state, and keyboard-friendly actions.
- Make the top item/action visually obvious without making every row equally loud.

### Success Criteria

- A user can open Fallback and understand the top five things needing attention without visiting GitHub.
- Each My Work item has a clear reason label and next action.
- Snooze, mute, and done states are durable and reversible.
- My Work does not become a raw GitHub notification clone.

## Initiative 2: Make Offline PR Review Magical

### Goal

Make PR review feel like a local document with GitHub sync attached. The user should trust that review work survives network loss, app restart, GitHub outages, and stale PR heads.

### Target Behavior

When reopening a PR with review work in progress, Fallback should show a resume state:

`You started reviewing this PR yesterday. 2 draft comments, 5 reviewed files. The PR has 1 new commit since then.`

Actions:

- Resume review.
- Show changes since draft.
- Continue from next unreviewed file.
- Submit now.
- Queue if offline or GitHub is degraded.
- Edit queued review.
- Retry or cancel failed queued review.

### Implementation Notes

- Strengthen review draft metadata: reviewed files, head SHA, last opened time, last edited time, stale state, and comment counts.
- Add "changed since draft" copy based on PR head changes and diff metadata.
- Make queued review state visible from PR detail, PR diff, My Work, and the offline queue.
- Keep stale inline comments safe: warn when a comment may no longer map cleanly before submit.
- Add a compact send preview before submission: account, event, comment count, target PR, head state, online/queued result.
- Keep the review surface dense and code-first: file tree, diff, draft state, and review composer should feel like one focused workbench.
- Use compact banners or inline status bars for stale draft and queued-send state instead of large interruption panels.

### Success Criteria

- Review drafts survive restart and network loss.
- A stale draft explains what changed and what is still safe.
- Queued review submission is visible, editable where safe, retryable, and cancellable.
- The user never has to wonder whether a review was lost or sent.

## Initiative 3: Make Git Safety The Product Soul

### Goal

Unify local Git mutations around one recognizable safety ritual: explain state, describe risk, perform the action, record the result, and offer recovery.

### Standard Flow

For every risky local action, use the same structure:

1. State: what branch, upstream, dirty state, ahead/behind, identity, signing, and credential state Fallback sees.
2. Risk: what may conflict, fail, discard data, or affect protected branches.
3. Action: the primary action plus safer alternatives.
4. Result: what changed, including before/after HEAD and affected files where possible.
5. Recovery: how to undo, recover, or inspect the operation.

### Actions In Scope

- Fetch.
- Pull.
- Push.
- Publish branch.
- Switch branch.
- Switch workspace.
- Stash all.
- Stash selected files.
- Apply/pop stash.
- Discard local file.
- Revert commit.
- Commit local changes.
- Abort conflict.
- Create/remove worktree.

### Implementation Notes

- Create a shared copy model for preflight and result summaries.
- Reuse local Git network preflight, conflict preflight, operation records, and recovery records.
- Prefer preview panels and confirm dialogs that share structure rather than one-off warnings.
- Add a consistent "copy report" action for support and self-debugging.
- Add recovery-oriented CTAs to operation records, not just passive history.
- Use one recognizable safety panel pattern across Git actions: compact state grid, risk callout, primary action, safer alternatives, and recovery details.
- Keep destructive actions visually restrained until confirmation, then make the exact destructive target unmistakable.

### Success Criteria

- Risky Git actions feel consistent across the app.
- Operation records explain what happened in human language.
- Recovery information is visible immediately after risky actions.
- The user learns to trust the pattern: Fallback explains before it mutates.

## Initiative 4: Reframe Branch Integrity For Normal Developers

### Goal

Keep the powerful Branch Integrity model, but present it as a plain-language branch safety feature.

### Naming Options

Preferred user-facing names:

- `Branch Watch`
- `Branch Safety`
- `Branch Change Monitor`

Internal names can remain `branchIntegrity`.

### Plain-Language Finding Copy

Map internal finding kinds to user-facing labels:

| Internal kind                  | User-facing label                               |
| ------------------------------ | ----------------------------------------------- |
| `tested_tree_mismatch`         | Merged code differs from tested code            |
| `expected_tree_mismatch`       | Branch content differs from expected PR result  |
| `landed_diff_too_large`        | Merged change was larger than expected          |
| `landed_diff_too_small`        | Merged change was smaller than expected         |
| `possible_reversion`           | A previous change may have been undone          |
| `missing_pr_content`           | Expected PR content is missing                  |
| `unexpected_direct_push`       | Branch changed outside the usual PR flow        |
| `missing_merge_group_evidence` | No merge queue evidence was found               |
| `unknown_merge_source`         | Fallback cannot identify how this change landed |
| `checkpoint_gap`               | Branch history changed across an unobserved gap |

### Finding Card Structure

Each finding should show:

- What happened.
- Why it matters.
- Evidence.
- Suggested recovery.
- Actions: inspect landed diff, inspect expected diff, create recovery branch, open recovery PR, copy report, mark resolved.

### Implementation Notes

- Add shared mapping helpers for finding labels, summaries, and severity copy.
- Keep advanced evidence available behind details, not in the first line.
- Use "suspicious branch change" language in empty states, sidebar badges, and reports.
- Make the recovery plan the star of the detail panel when a safe plan exists.
- Design findings as dense evidence rows with a focused detail pane, not as large alert cards.
- Use severity color sparingly and consistently: the title explains the issue, color only sets urgency.

### Success Criteria

- A developer who does not know tree SHAs can understand why a finding matters.
- Finding titles are understandable without reading the evidence object.
- Copy reports remain detailed enough for experts.
- Branch Watch feels like a differentiator rather than an internal audit console.

## Initiative 5: Turn Worktrees Into Parallel Workspaces

### Goal

Make worktrees understandable as parallel workspaces first, and agent sessions second.

### Product Frame

`Parallel Workspaces` means:

> Keep separate lines of work isolated, visible, and easy to clean up.

This helps humans and agents:

- Main working copy.
- Feature branch.
- Hotfix.
- Experiment.
- Review checkout.
- Agent task.

### Workspace Card Fields

Each workspace should show:

- Branch.
- Dirty or clean state.
- Ahead/behind when available.
- Associated PR or issue when available.
- Last activity.
- Origin: user, imported, agent, unknown.
- Local path.
- Safe cleanup status.
- Actions: switch, open editor, open terminal, create PR, stash, remove, prune.

### Agent Layer

Do not lead with AI. Add agent provenance as a workspace source:

`Agent session produced these changes. Review diff, commit, discard, or open PR.`

Agent-related metadata can be added later:

- Session id.
- Prompt/task title.
- Created branch.
- Changed files.
- Tests run.
- Last agent activity.
- Review status.

### Implementation Notes

- Rename user-facing worktree surfaces to workspaces where possible.
- Keep Git terminology visible in details for users who need it.
- Add origin/provenance fields only when the source is known.
- Make cleanup safety explicit: safe to remove, dirty, locked, missing, or needs manual review.
- Present workspaces as a compact operational table or split list/detail view, not a gallery.
- Keep workspace actions close to the row/detail they affect, with command palette equivalents for expert flow.

### Success Criteria

- Users understand why a workspace exists and whether it is safe to remove.
- Workspaces become part of the normal local Git safety story.
- Agent-created work can be reviewed as local changes with provenance, not treated as magic.

## Initiative 6: Tighten The Product Story

### Goal

Align README, docs, empty states, onboarding, and in-app copy around the bigger product story.

### Proposed Positioning

Short:

> Fallback keeps GitHub work, local changes, and branch state coherent when repo work gets messy.

Long:

> Fallback is a local-first GitHub workbench for professional repository work. It keeps PRs, issues, reviews, comments, checks, local changes, operation history, and branch safety context available locally so you can keep working, reviewing, and recovering even when GitHub, the network, or local Git state is unreliable.

### Messaging Pillars

- `Never lose context`: cached PRs, issues, reviews, comments, checks, search.
- `Never lose review work`: local drafts, queued reviews, retryable writeback.
- `Understand before you mutate`: preflights, conflict risk, identity/signing checks.
- `Recover with evidence`: operation records, recovery records, branch safety reports.
- `Work in parallel safely`: workspaces for humans and agents.

### Implementation Notes

- Update README after the product surfaces match the promise.
- Update docs to introduce My Work as the daily starting point.
- Rework empty states to explain the next action, not the feature itself.
- Add consistent copy for offline, degraded GitHub, stale cache, stale review draft, blocked action, branch safety risk, and dirty workspace states.

### Success Criteria

- A new user understands Fallback's value in one minute.
- The docs and app describe the same product.
- The product no longer sounds narrower than what the app already does.

## Suggested Delivery Order

### Phase 1: Language And Hierarchy

- Add shared plain-language copy helpers for attention reasons, Git safety states, and branch findings.
- Reframe Branch Integrity copy in the UI while keeping internal names stable.
- Strengthen My Work item summaries and next-action labels.
- Apply the Vercel/Linear design contract to the first changed surfaces: calm density, precise alignment, quiet metadata, strong focus states, and no decorative UI.
- Update docs only after UI terms settle.

### Phase 2: My Work As Home Base

- Add lanes for Needs me, Waiting, At risk, Snoozed, and Muted.
- Include blocked offline actions and branch safety incidents.
- Add deterministic "why this is here" and "what changed" summaries.
- Add tests for attention derivation and renderer filtering.

### Phase 3: Review Continuity

- Add PR review resume state.
- Add stale-head draft explanation.
- Add send preview and queue visibility improvements.
- Add tests around stale drafts, queued reviews, and retry/cancel behavior.

### Phase 4: Git Safety Pattern

- Standardize preflight and result panels across local Git actions.
- Add recovery CTAs to operation records.
- Add copy-report behavior across conflict, operation, and credential diagnostics.
- Add tests for copy helpers and local Git result mapping.

### Phase 5: Parallel Workspaces

- Reframe worktree UI as Parallel Workspaces.
- Add workspace provenance where available.
- Add cleanup safety states and actions.
- Add agent-origin metadata only once there is a concrete agent workflow to attach.

### Phase 6: Product Story Pass

- Update README, docs, onboarding, and empty states.
- Add screenshots or guided first-run content only if the app needs it.
- Ensure marketing language does not overpromise beyond implemented flows.

## Risks

- Too much explanatory copy can make the app feel less dense and professional.
- My Work can become noisy if every signal is treated as urgent.
- Branch safety can scare users if warnings do not distinguish confidence and severity clearly.
- Agent language can make the product feel speculative if it appears before the workspace safety model is useful.
- Renaming user-facing concepts can break docs/tests if internal and external names are not separated carefully.

## Verification

For each implementation slice:

- Run focused unit or renderer tests for the touched domain.
- Run `pnpm typecheck`.
- Run `pnpm lint`.
- Run `pnpm format`.
- Finish with `pnpm beta:check` before handoff when the slice includes code or broad docs/app changes.

For UX-heavy slices:

- Run the app locally.
- Verify My Work, PR review, Local Changes, Branch Watch, and Workspaces in realistic repo states.
- Check empty, loading, error, offline, degraded GitHub, and blocked-action states.
- Check keyboard navigation, focus-visible states, hover/active states, disabled/loading states, long text, narrow widths, and dense data.
- Confirm the changed screens still match the Vercel/Linear-inspired direction in `DESIGN.md`: dark-first, compact, precise, and operational.
- Capture before/after screenshots for visual review.

## Non-Goals

- Do not chase full GitKraken/Tower/SmartGit feature parity.
- Do not make Fallback a GitHub.com clone.
- Do not add AI branding before workspace provenance and safety are useful.
- Do not hide Git so much that advanced users cannot inspect the underlying state.
- Do not replace terminal/editor handoff; make handoff safer and better explained.
