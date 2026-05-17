# Fallback — Design Document

> A desktop GitHub client built with the visual language of Vercel and Linear: minimal, dark-first, typographically precise, and spatially deliberate.

---

## Design Philosophy

Fallback merges two design traditions into a single desktop experience:

- **Vercel**: Pure black canvas, breadcrumb-driven context, deployment-status visual language, generous whitespace, OLED-maximized contrast
- **Linear**: Fixed sidebar navigation, keyboard-first interaction, icon+label+count pattern, filter-driven list views, command palette as primary navigation accelerator

The result is a tool that treats GitHub data with the same visual precision these products bring to deployments and project management.

### Core Principles

1. **Reduction over decoration** — No gradients, no color fills, no visual noise. Meaning is conveyed through spacing, weight, and opacity alone.
2. **Information density without clutter** — Show more data in less space by relying on typographic hierarchy rather than containers and dividers.
3. **Monochrome with signal color** — The palette is neutral-900 through white. Color enters only to communicate state: green for success, red for error, purple for merged, blue for links.
4. **Keyboard-native** — Every view is reachable via shortcut. The command palette (`⌘K` / `F`) is the universal escape hatch.
5. **Offline-first confidence** — Sync state is visible but never anxious. The UI communicates freshness without demanding attention.

---

## Application Structure

### Views

| View          | Scope  | Purpose                                                       |
| ------------- | ------ | ------------------------------------------------------------- |
| Home          | Global | Repository browser, storage management, add/remove repos      |
| My PRs        | Global | Cross-repo pull request inbox                                 |
| GitHub Status | Global | API health dashboard                                          |
| Code          | Repo   | File browser, commits, branches, tags, releases, contributors |
| Local Changes | Repo   | Staged/unstaged files, commit composer, stash management      |
| Issues        | Repo   | Filterable issue list with detail view                        |
| Pull Requests | Repo   | Filterable PR list with activity + diff review                |
| Actions       | Repo   | Workflow run status                                           |
| Settings      | Global | Auth, workspace config, sync frequency, cache                 |

### Navigation Model

```
Global views → always accessible
Repo-scoped views → appear when a repository is selected
```

Selecting a repo in the sidebar unlocks its scoped views. The sidebar dynamically shows/hides repo-scoped items based on selection state. Local Changes only appears when the working tree is dirty or stashes exist.

---

## Shell Layout

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar (260px)        │  Main Content (flex-1)         │
│                         │                                │
│  ┌───────────────────┐  │  ┌──────────────────────────┐  │
│  │ Logo + Controls   │  │  │ Top Context Bar (56px)   │  │
│  │ (68px)            │  │  │ Breadcrumb / Page title   │  │
│  ├───────────────────┤  │  └──────────────────────────┘  │
│  │ Search (68px)     │  │  ┌──────────────────────────┐  │
│  │ "Find..." [F]     │  │  │ Tab Bar (48px, optional) │  │
│  ├───────────────────┤  │  └──────────────────────────┘  │
│  │ Navigation        │  │  ┌──────────────────────────┐  │
│  │ (flex-1, scroll)  │  │  │ Content Area             │  │
│  │                   │  │  │ (flex-1, overflow-y-auto) │  │
│  │ • Global items    │  │  │ padding: p-6             │  │
│  │ ─── separator ─── │  │  │ gap: space-y-6           │  │
│  │ • Repo items      │  │  │                          │  │
│  │                   │  │  │                          │  │
│  ├───────────────────┤  │  │                          │  │
│  │ Profile (bottom)  │  │  │                          │  │
│  │ Sync indicator    │  │  └──────────────────────────┘  │
│  └───────────────────┘  │                                │
└──────────────────────────────────────────────────────────┘
```

### Window Chrome

Custom frameless window. The Fallback logo in the sidebar header morphs into macOS traffic lights on hover — a signature interaction:

- **Resting**: 32×32 logo mark, centered, `drop-shadow-md`
- **Hover**: Logo rotates -8°, scales down, fades. Three 14×14 circles appear (close/minimize/expand)
- **Circle hover**: `border-neutral-200/70 bg-neutral-300 text-black`
- **Transition**: `duration-200 ease-out`

The entire top area is a drag region (`-webkit-app-region: drag`), with interactive elements carved out (`no-drag`).

---

## Color System

### Background Layers

| Layer    | Value     | Usage                                           |
| -------- | --------- | ----------------------------------------------- |
| Canvas   | `#000000` | App background, main content area               |
| Surface  | `#0A0A0A` | Inputs, panels, dropdown menus, cards           |
| Subtle   | `#050505` | Nested input fields                             |
| Elevated | `#111111` | Active nav items, hover states, command palette |

### Foreground / Text

| Token     | Value         | Usage                                     |
| --------- | ------------- | ----------------------------------------- |
| Primary   | `#EDEDED`     | Headings, active labels                   |
| Secondary | `neutral-300` | Body text, descriptions                   |
| Tertiary  | `neutral-400` | Breadcrumbs, meta text, inactive tabs     |
| Muted     | `neutral-500` | Icons, placeholders, timestamps           |
| Ghost     | `neutral-600` | Divider text, disabled labels, separators |

### Signal Colors

| Signal           | Token                 | Usage                                       |
| ---------------- | --------------------- | ------------------------------------------- |
| Success / Open   | `emerald-500`         | Sync complete, CI pass, open state dot      |
| Error / Closed   | `red-400` / `red-900` | Failed actions, closed state, error borders |
| Merged           | `purple-500`          | Merged PR state dot                         |
| Warning / Active | `amber-400`           | Syncing, queued, pending CI                 |
| Link             | `blue-400`            | Clickable references, file hover state      |

### Borders

| Context            | Value                                         |
| ------------------ | --------------------------------------------- |
| Default            | `#1a1a1a` (sidebar dividers, section borders) |
| Card/Input resting | `neutral-800` or `#2a2a2a`                    |
| Input focus        | `neutral-600`                                 |
| Error              | `red-900/30`                                  |
| Tab active         | `white` (2px bottom border)                   |

---

## Typography

### Font Stack

```css
--font-sans: "Inter", "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
```

### Scale

| Role             | Size    | Weight         | Tracking | Example                  |
| ---------------- | ------- | -------------- | -------- | ------------------------ |
| Page title       | 28px    | 600 (semibold) | tight    | Repository name          |
| Section label    | 18px    | 500 (medium)   | normal   | Panel headings           |
| Body             | 13–14px | 400            | normal   | Descriptions, list items |
| Label / Meta     | 12px    | 500            | normal   | Counts, sidebar labels   |
| Badge / Shortcut | 10px    | 400 (mono)     | normal   | Keyboard hints           |
| Overline         | 12px    | 500            | `0.14em` | Dropdown section headers |

### Rules

- Headings are always `text-white` (full brightness)
- Body text uses `neutral-200` to `neutral-400` for progressive de-emphasis
- Uppercase overlines use aggressive tracking (`0.14em`) in `neutral-500`
- Monospace (`font-mono`) for: SHAs, branch names, keyboard shortcuts, file paths, code

---

## Spacing System

| Context             | Value                                         |
| ------------------- | --------------------------------------------- |
| Page padding        | `px-6 py-6`                                   |
| Section gaps        | `space-y-6`                                   |
| Component internal  | `space-y-2` to `space-y-4`                    |
| Inline element gaps | `space-x-1.5` to `space-x-3`                  |
| Nav item padding    | `px-3 py-1.5`                                 |
| Button padding      | `px-4 py-2` (standard), `px-2 py-1` (compact) |
| Card padding        | `p-6`                                         |

---

## Components

### Sidebar Navigation Item

```
[icon 18×18] [label 13px]                [count badge | shortcut]
```

| State     | Style                                                     |
| --------- | --------------------------------------------------------- |
| Resting   | `text-neutral-400`, icon `text-neutral-500`               |
| Hover     | `bg-[#111111]`                                            |
| Active    | `bg-[#111111] font-medium`, icon+label `text-neutral-200` |
| Separator | `h-px bg-neutral-900 mx-3 my-3`                           |

### Search Bar

- Container: `bg-[#0a0a0a] border border-[#2a2a2a] rounded-md h-9`
- Placeholder: "Find..." in `text-neutral-600`
- Icon: `SearchIcon` 14×14 `text-neutral-500`
- Shortcut badge: `F` in bordered mono pill
- Hover: `border-neutral-500`

### Top Context Bar (Code View)

Vercel-style breadcrumb showing repository context:

```
● Production  /  ⑂ main  /  a3f8c21          [Watch 12] [Fork 3] [Star 89]
```

- Height: 56px, drag region
- Green dot: `w-1.5 h-1.5 rounded-full bg-emerald-500`
- Separators: `/` in `text-neutral-600`
- Actions: icon + count, `text-neutral-500 → hover:text-white`

### Tab Bar

Horizontal tabs for sub-views within Code:

```
Files   Commits 42   Branches 8   Tags 12   Releases 3   Contributors 15
─────────────────────────────────────────────────────────────────────────
```

- Height: 48px
- Active: `border-b-2 border-white text-white font-medium`
- Inactive: `border-transparent text-neutral-400 hover:text-neutral-200`
- Count: `text-[10px] px-1.5 py-0.5 rounded-full border border-neutral-800`

### Buttons

| Variant  | Style                                                             |
| -------- | ----------------------------------------------------------------- |
| Primary  | `bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md` |
| Ghost    | `bg-transparent hover:bg-neutral-900 text-neutral-400`            |
| Danger   | `border border-red-900/30 text-red-400 hover:text-white`          |
| White    | `bg-white text-black hover:bg-neutral-200 rounded-md`             |
| Disabled | `opacity-50 cursor-wait`                                          |

### Input Fields

```css
bg-[#050505] border border-neutral-800 rounded-md
px-3 py-2 text-[13px] text-neutral-200
placeholder:text-neutral-600
focus:border-neutral-600 outline-none
```

### Cards / Panels

```css
border border-neutral-800 rounded-lg p-6 bg-[#0A0A0A]
```

- Internal spacing: `space-y-5`
- Title: `text-neutral-200 text-lg font-medium`
- Description: `text-neutral-500 text-sm`

### Dropdown Menus

```css
rounded-lg border border-neutral-800 bg-[#0A0A0A] shadow-2xl
```

- Section header: `text-xs font-medium uppercase tracking-[0.14em] text-neutral-500`
- Items: `px-3 py-2.5 text-[13px] text-neutral-300 hover:bg-neutral-900`
- Max height: `max-h-72 overflow-y-auto`

### Command Palette

- Backdrop: Radial gradient noise + `bg-black/78 backdrop-blur-[10px]`
- Container: `max-w-[640px] rounded-[14px] bg-[#111111] border-[#262626]`
- Shadow: `0 28px 90px rgb(0 0 0 / 0.78)`
- Input inside with full-width search, results below

### Entity State Dots

Used for PRs and Issues in list views:

| State  | Style                               |
| ------ | ----------------------------------- |
| Open   | `bg-emerald-500 border-emerald-500` |
| Merged | `bg-purple-500 border-purple-500`   |
| Closed | `bg-red-500 border-red-500`         |

6×6 outer circle with 1.5×1.5 inner dot, vertically centered.

### Sync Status Badge

| Status         | Style                                          |
| -------------- | ---------------------------------------------- |
| Fresh          | `text-emerald-500 bg-emerald-500/10`           |
| Syncing/Queued | `text-amber-400 bg-amber-500/10 animate-pulse` |
| Failed         | `text-red-400 bg-red-500/10`                   |
| Default        | `text-neutral-400 bg-neutral-800`              |

### Error Banners

```css
border border-red-900/30 rounded-lg p-3 bg-[#110000] text-red-400 text-sm
```

Offline variant: `border-neutral-800 bg-[#0A0A0A] text-neutral-400`

---

## View Designs

### Home

The repository management hub. A clean list of watched repositories with inline sync status.

**Repository Row:**

- Name (semibold, white) with owner prefix (neutral-400)
- Description (neutral-400, truncated)
- Sync badge (right-aligned)
- Open issues/PRs count
- Last sync timestamp
- Hover reveals delete action (Trash2 icon, danger style)

**Add Repository Panel** (card):

- Manual input: `owner/name` format
- GitHub picker: search-as-you-type when authenticated
- Sync frequency selector

**Storage Bar:**

- Horizontal bar showing cache usage by repo
- Segmented, color-coded per repo
- Total size label

### Code

A multi-tab file/history browser. Mirrors GitHub's repository page structure.

**Files tab**: Tree browser with columns — name, last commit message, date. Directories first, files second. Click navigates into folders, breadcrumb for path.

**Commits tab**: Chronological list — author avatar, message (truncated), timestamp, verified badge. Each row 72px min-height.

**Branches tab**: Table — branch name (mono), default/protected badges, latest SHA.

**Tags tab**: Table — tag name, download button.

**Releases tab**: Table — version, release notes preview.

**Contributors tab**: Table — avatar, login, contribution count.

### Pull Requests / Issues

Linear-style filterable list with structured query support.

**Filter Bar:**

- Full-width input supporting GitHub query syntax (`is:pr`, `is:open`, `assignee:@me`, `label:"bug"`)
- Active filters render as green pills (`border-emerald-500/25 bg-emerald-500/12`)
- Preset dropdown with common queries
- Label filter selector

**List Item (72px min-height):**

- State dot (left)
- Number + title
- Author avatar + login
- Last synced timestamp (right)

### PR Detail

Two-tab view: Activity and Changes.

**Activity tab:**

- PR description with metadata header (author, created date, state badge)
- Timeline of comments and review comments
- Reply composer at bottom (textarea + submit)
- Review actions: Approve, Request Changes, Comment

**Changes tab (Diff Review):**

- File sidebar (sticky on xl+):
  - Nested folder tree
  - Reviewed checkmarks per file
  - Diff stats (+green / -red line counts)
  - Comment count badges
- Main diff area:
  - Full-width unified diff with syntax highlighting
  - Line selection for inline review comments
  - Inline comment composer
  - Reviewed checkbox per file header

### Issue Detail

Single-tab conversation view:

- Title with number, state badge
- Description + comment timeline
- Reply composer

### Local Changes

Git working tree management. Only visible when dirty or stashes exist.

**File List:**

- Staged/unstaged checkbox (supports mixed state)
- File path with additions (+green) / deletions (-red) counts
- Discard button per file

**Commit Composer:**

- Summary input (single line)
- Description textarea (optional)
- Sign-off checkbox
- Commit / Amend buttons

**Stash Panel:**

- List of stashes with message
- Apply / Pop / Drop actions per entry

### Actions

Workflow status mapped to recent PRs:

- PR title + branch
- Check status indicators (green circle = pass, red = fail, amber = pending)
- Run timestamp
- Link to workflow

### Settings

Card-based sections:

- **Authentication**: GitHub OAuth device flow with code display
- **Workspace**: Path configuration
- **Sync**: Frequency selector (5/15/30/60/120/240 min)
- **Cache**: Size display, clear cache button
- **Advanced**: Watch mode, clone behavior toggles

---

## Iconography

### Libraries

- **Primer Octicons** (`@primer/octicons-react`) — GitHub-native: repos, PRs, issues, workflows, code
- **Lucide** (`lucide-react`) — UI chrome: X, Copy, ChevronDown, Trash2, RotateCcw, ExternalLink

### Sizing

| Context               | Size  |
| --------------------- | ----- |
| Navigation items      | 18×18 |
| Inline actions        | 16×16 |
| Search / button icons | 14×14 |
| Top bar actions       | 16×16 |

### Color

- Resting: `text-neutral-500`
- Active/hovered: inherits parent `text-white`
- Nav active: `text-neutral-200`

---

## Motion & Interaction

### Transitions

| Context         | Value                                       |
| --------------- | ------------------------------------------- |
| Default         | `transition-colors` (150ms browser default) |
| Window controls | `transition-all duration-200 ease-out`      |
| Sync indicator  | `animate-pulse`                             |

### Hover Patterns

| Element     | Resting → Hover                          |
| ----------- | ---------------------------------------- |
| Text links  | `neutral-400` → `white`                  |
| Backgrounds | transparent → `neutral-900` or `#111111` |
| Borders     | `#2a2a2a` → `neutral-500`                |
| File names  | neutral → `blue-400` (via `group-hover`) |

### Focus

- Inputs: `focus:border-neutral-600` (border brightens, no ring)
- Keyboard navigation via command palette, not focus outlines

### Loading

- Button: `disabled:opacity-50 disabled:cursor-wait`
- Inline: "Loading..." in `text-neutral-500`
- Sync: Animated pulse indicator in sidebar footer

---

## Scrolling

- Custom webkit scrollbar: 8px width
- Track: transparent
- Thumb: `bg-neutral-800 rounded-full`, hover `bg-neutral-700`
- Body: `overflow: hidden` — all scroll is contained within content areas
- Dropdowns: `max-h-72 overflow-y-auto`

---

## Keyboard Shortcuts

| Key         | Action                                            |
| ----------- | ------------------------------------------------- |
| `⌘K` / `F`  | Open command palette                              |
| `H`         | Go to Home                                        |
| Number keys | Quick-switch between repos (when palette is open) |

The command palette is the primary keyboard accelerator — search for repos, navigate views, trigger actions.

---

## Electron Integration

### Z-Index Layers

| Layer                    | Z-Index | Usage                    |
| ------------------------ | ------- | ------------------------ |
| Window controls          | 20      | Traffic light buttons    |
| Profile menu             | 30      | Bottom-anchored dropdown |
| Command palette backdrop | 40      | Overlay                  |
| Modal content            | 50      | Top-level overlays       |

### IPC Boundaries

The renderer communicates with main via `window.fallback.*` — auth, repos, cache, health, window controls. All data fetching goes through TanStack Query with configurable stale times and polling intervals.

---

## Key Design Decisions

1. **Pure black canvas** (`#000000`) — Maximizes OLED contrast and creates the deepest possible backdrop. Content "floats" rather than sitting in containers. Directly inspired by Vercel's dashboard.

2. **No decorative containers** — Content floats on the black canvas. Cards (`bg-[#0A0A0A]`) are reserved for actionable containers only (settings panels, add-repo form). Data lists need no wrapper.

3. **Breadcrumb as spatial context** — The top bar uses Vercel-style `/`-separated breadcrumbs to communicate position: Production / branch / commit SHA.

4. **Linear's sidebar DNA** — Fixed 260px, icon+label+count, keyboard shortcuts shown inline, collapsible sections. The sidebar is always the anchor point.

5. **Typography does the heavy lifting** — No colored backgrounds or oversized icons for hierarchy. Size (28px → 13px), weight (semibold → regular), and opacity (white → neutral-400) create all structure.

6. **Monochrome badges** — Count pills use `border border-neutral-800` on black, not filled backgrounds. Active state just brightens. No color unless it means something.

7. **Deliberate emptiness** — `space-y-6` gaps, `p-6` padding. The app feels calm. Dense data is legible because it has room to breathe.

8. **State dots, not state text** — PR/issue state is a 6px colored dot, not a word. Users learn the color language fast; it's spatially efficient and visually quiet.

9. **Filter bar as query language** — Following Linear's approach, the PR/issue filter bar is a structured query input that parses GitHub search syntax into removable pills. Power users type queries; casual users use the preset menu.

10. **Offline-aware, not offline-anxious** — Sync state is shown via small badges and a subtle footer indicator. The UI never screams about freshness — it trusts the user to check when they care.
