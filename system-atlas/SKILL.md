---
name: system-atlas
description: Build and maintain an explorable, progressively-disclosed isometric "atlas" of a system's architecture — an interactive page (hover to read, click to pin, go inside for steps, moving data packets you can inspect, chapters that reveal the system a few structures at a time) plus a generated text twin (SYSTEM.md) and question tracking by ID, all from one data file in the repo. Use this whenever someone wants to discuss, design, review, or explain an architecture visually — "make an atlas", "map the system", "make the architecture explorable", "visualize the codebase/agent/pipeline so we can talk about it", "a diagram I can click around", "walk me through how it fits together", or when an architecture discussion is producing a pile of open questions that need tracking across feedback rounds. Also use it to update an existing atlas after decisions change.
---

# System Atlas

An atlas is one data file that renders two views: an **interactive isometric map** (a single self-contained HTML file), and a **generated text twin** (`SYSTEM.md`) with the decisions table, every structure, the flows, and the open questions by ID. The data file is the only thing anyone edits; both views rebuild from it. It sits beside the repo's hand-written glossary and ADRs.

The reason for this shape: an architecture discussion produces decisions, questions, and vocabulary faster than any one document can hold, and the person you are discussing with wants to *see* the system, not read it. The map is for them; the text twin is for the repo and for you next session; the single source is what keeps the two honest.

This skill was distilled from building a real agent-architecture atlas across one long design session and several rounds of feedback. The user's corrections from that session are the rules below; `references/process-and-lessons.md` has the story.

## When to reach for it — and when not

Use it when the system is new enough that vocabulary, decisions, and questions are still moving, and there will be more than one feedback round. Don't use it for a finished system that only needs a README, or for one diagram in a PR.

## Process

Follow the order — each step was earned by a correction the first time round.

1. **Read the inputs before drawing.** The vision doc, the repo's existing surfaces, and whatever prior art the user allows (ask — they may forbid a branch or a source). If you will build on a framework, read its docs first; hand long docs to a subagent with your specific design questions and have it return a primer with gotchas and a "what it does not give us" list. Drawing before this produces boxes that don't map to anything real.
2. **Discuss before drawing.** Propose the structure in chat, mapped to the runtime's real primitives, and ask only the questions you cannot derive from the repo. Take defaults for the rest and say which. Ask as plain chat text.
3. **First atlas — the whole system.** Copy `assets/` into the atlas home (`template.html`, `build.mjs`, `validate.mjs`, `sketch.mjs`, `layout.mjs`, `fold.mjs`, and `data.example.mjs` renamed to `data.mjs`; `sketch/` only if the user wants the local editor), fill the data, build, publish. The build checks `data.mjs` first (node ids in every hop, chapter flows touching only revealed structures, known `kind`s, required prose, question shapes) and writes nothing until every problem it lists is fixed. It then writes `SYSTEM.md`, `atlas.html` and `atlas.excalidraw` to the atlas home's parent. **Where the atlas home is depends on the repo's docs policy.** Some repos commit design docs freely, so `docs/<system>/atlas/` in-tree is right. Other repos deliberately commit only ADRs and a glossary, with specs and evidence going to the issue tracker. There the atlas home is `.scratch/<system>/atlas/`, the same scratch tree the engineering skills use for specs and tickets; make sure `.scratch/` is git-ignored, and attach `SYSTEM.md` plus the research to the spec issue as comments when the spec is published. Ask which policy applies before committing anything. Learned the hard way: committing the whole set produced a 3,900-line docs PR and four review rounds reconciling three restatements of one design. With ADRs plus a glossary only, there is one place to be consistent. If your agent has a design-guidance skill for HTML artifacts, load it before touching the template; read `references/design-language.md` for the visual rules either way.
4. **Progressive disclosure.** A whole system at once reads as noise ("hard to parse" was the first correction). Ten-ish chapters; each adds at most three structures and runs one small flow that only touches revealed structures; the last chapter shows everything with a flow picker. Unrevealed structures stay in the index, dimmed, with their chapter number. Panels are summary-first: one sentence, then *Read more* and *Steps* folded.
5. **Shapes and labels.** Letters on boxes are not enough ("better box shapes/labelling" was the second correction). Give each role a shape and put a readable name label on the canvas under every structure — see design-language.
6. **Text twin.** The glossary and ADRs are the in-tree pieces, and they live where the repo's domain-doc convention puts them (read `docs/agents/domain.md` or the equivalent; a single-context repo has one root `GLOSSARY.md` and `docs/adr/`). If a `domain-modeling` skill is available, it writes both; the atlas links to ADRs from `DECISIONS[].adr` and uses glossary terms in its prose. The glossary is nouns, one line each. ADRs are only for decisions that are hard to reverse, surprising without context, and the result of a real trade-off. `SYSTEM.md` is generated and `research/` holds evidence; both live with the atlas (scratch dir or `docs/`, per step 3). Don't open issues unless asked.
7. **Feedback by question ID.** Every question is `Q-<code><n>` with a state: open (a string), resolved `{q, r}` (answer + date), or routed `{q, to}` (handed to a named next step such as a research file or a prototype). The ID is the question's position in its structure's `cond` list, so resolve or drop questions in place and append new ones at the end. Record the user's words. If they call something "not a question", drop it; if they say "I don't get this", explain with a concrete example *before* resolving. After each round: rebuild, republish, update `NOTES.md`.
8. **Deep dives feed back.** If a `research` skill is available, run each deep dive through it and route the question as `{q, to: 'research: <file>'}`. Otherwise research with subagents against one shared brief (the interface we own, the requirements that separate candidates, a usage model for cost, a fixed deliverable shape) and write a synthesis with a normalized cost/fit grid. Either way, fold resolutions into the data as `{q, r: '… (from <file>, date)'}`. If the user rejects a proposal, sweep *every* file and rewrite. A banner on top of a stale section is not enough; they will find it.
9. **Keep it current.** "The atlas is great for me — but not if it's not up to date." One source, rebuild and republish after every change, never hand-edit generated files, and leave a `README.md` in the docs folder explaining the set (table in process-and-lessons).

## With the engineering skills

When a grilling, spec or ticket skill (`grill-with-docs`, `wayfinder`, `to-spec`, `to-tickets`, `implement`) runs in the same session, the atlas is the shared record and the other skill drives:

- **One interview.** The grilling skill asks the questions; the atlas records them. Each question it raises becomes a `cond` entry on the structure it concerns, each answer becomes `{q, r}` with the user's words and the date, and both of you refer to questions by Q-ID. Skip this skill's own question rounds (steps 2 and 7) while a grilling skill is driving. Rebuild after each grilling round, not after each answer.
- **Prototypes.** A question that needs running code goes to `{q, to: 'prototype: <name>'}`; when the prototype answers it, resolve it with a pointer to the prototype branch.
- **Wayfinder.** A question that becomes a decision ticket goes to `{q, to: '#<n>'}` (or the local ticket path), and resolves when the ticket closes.
- **Exit into the spec.** Before `to-spec`, every question is resolved, routed to a named follow-up, or listed in the spec as out of scope. The spec cites resolved Q-IDs for the decisions it relies on, and ghost structures go in its out-of-scope section. Attach `SYSTEM.md` to the spec issue (or keep it beside `spec.md` in `.scratch/<system>/`).
- **Tickets.** Offer the chapters to `to-tickets` as candidate tracer-bullet slices: each chapter adds a few structures and one flow that runs end to end.
- **After implementation.** When the build deviates from the design, edit `data.mjs` and rebuild in the same session.
- **Context budget.** The engineering flow keeps grilling, spec and tickets in one context window. Keep only `data.mjs` edits in the main window, and hand the template work, build, static serve and browser verification (see below) to a subagent that returns the URL, the build line and any failures.

## Sketching with Excalidraw

The build also writes `atlas.excalidraw`, a flat top-down plan of the same structures with an arrow for every pair of nodes a flow connects. It is where the user thinks with a pen: they move, add, connect and annotate, then tell you "updated diagram". The sketch is feedback, never a source. `data.mjs` stays the only thing anyone edits, and you never draw in the sketch yourself.

- **The trigger.** When the user's message contains "updated diagram" (or "updated the sketch"), anywhere in it, run `fold.mjs` as your first tool call, before checking servers or reading notes, and lead your reply with its list. Do not watch the file or poll for changes between messages; the user's phrase is the only trigger.
- **Layout** (`layout.mjs`). Each box is centred on its footprint centre (`gx + w/2`, `gy + d/2`) and sized to its label, measured with the editor's font. The build picks the smallest scale (px per grid unit) at which boxes keep a clear gap and every labelled arrow has room for its label, and keeps that scale across rebuilds while it still fits, so boxes don't jump. Arrows go straight when they can, bow apart when two run opposite ways between the same boxes, and otherwise route orthogonally through the channels between boxes, with the label on a clear leg.
- **Legibility is part of done.** The build prints legibility warnings for both views: name tags covering each other on the isometric map, and in the sketch text spilling out of a box, boxes or labels overlapping, or arrows crossing boxes or labels. Footprints that overlap are a build error. Treat a warning like a failing check: fix it by moving structures in `data.mjs` (`gx`/`gy`, which also improves the isometric map) or shortening a label, and rebuild until there are none. In the editor, `window.atlasLayoutIssues()` runs the same check on Excalidraw's own font measurements.
- **What the user's marks mean** (the legend at the top of the canvas says the same): a plain box with a label proposes a structure, dashed means not built yet; a filled box or loose text is a note, and becomes a question on the nearest box; an arrow between boxes proposes a flow hop; moving, renaming, dashing or deleting a generated box or arrow proposes that change (box sizes follow their labels, so a resize is not a proposal); text like `Q-I1: use restic` resolves that question.
- **Fold.** Run `node <atlas home>/fold.mjs`. It numbers the changes it reads and saves them to `sketch-proposal.json`. Show the user the list in plain words, and for each item say what you would change in `data.mjs` (a new node needs an id, a `kind`, prose; a question needs the structure it belongs to). Ask about anything the script calls a drawing or an unattached note, since only the user knows what a scribble meant. Apply only what they confirm.
- **Settle and rebuild.** After editing `data.mjs`, run `fold.mjs --accept <n,…> --dismiss <n,…>` (either takes `all`), then `build.mjs`. Accepted new boxes and arrows are removed from the sketch and drawn again from `data.mjs`; notes stay on the canvas, dimmed; a dismissed change to a generated box goes back to what `data.mjs` says. Anything not settled stays pending, and rebuilds keep it.
- **Merging.** Elements with ids starting `atlas-` are generated. A rebuild rewrites a generated element only where `data.mjs` changed since the last build (`sketch-base.json` records that), so a pending move or rename is never undone by an unrelated rebuild. The user's own elements are never touched by the build.
- **Where to edit it.** Either open `atlas.excalidraw` at excalidraw.com (Chromium can open and save a local file in place; the scene stays in the browser), or run the local editor: copy `assets/sketch/` into the atlas home, then `cd <atlas home>/sketch && pnpm install --frozen-lockfile && pnpm start` (a production build plus `vite preview`; `pnpm dev` is only for working on the editor itself, since dev builds of React and Excalidraw are much slower) and open `http://127.0.0.1:5178`. It autosaves to the file, reloads live when `build.mjs` or `fold.mjs` rewrites it (merging with unsaved edits by element version), and serves `atlas.html` at `/atlas.html` on the same port. A panel in the bottom-right corner shows the numbered list `fold.mjs` would print for the saved sketch, updated after each autosave, rebuild or `data.mjs` edit, so the user sees what you will read before saying "updated diagram"; clicking an item selects its elements on the canvas. The panel is read-only (`GET /fold` writes no proposal), so the numbers you act on still come from your own `fold.mjs` run. It binds to loopback, refuses cross-origin writes and has no auth. Run it in the background and leave it running across rounds.
- **Viewing from another machine.** When the agent runs on a different machine from the person's browser (a server, a remote dev box, an embedded preview that streams pages from the agent's host), a loopback URL either fails or gets rendered remotely and streamed back, which is laggy and blurry for a canvas. If `tailscale` is on the PATH and `tailscale status` shows it connected, wrap the port with Tailscale Serve instead of binding wider:
  1. Check `tailscale serve status` for the port first, and pick another `ATLAS_SKETCH_PORT` if it is taken.
  2. Tell the person that every device on their tailnet will be able to read and overwrite the sketch (the server has no auth), then run `tailscale serve --yes --bg --https=5178 http://127.0.0.1:5178`. It needs the user to be a tailscale operator; if it reports access denied, ask instead of reaching for sudo.
  3. Hand over `https://<MagicDNS name>:5178` (from `tailscale status --self --json`, `Self.DNSName` without the trailing dot) for both the sketch and `/atlas.html`.
  4. When the person is done with the atlas, run `tailscale serve --https=5178 off`; the mapping otherwise persists across reboots. Record the mapping in `NOTES.md` while it is up.

  Never use `tailscale funnel`, which publishes to the internet. The editor already accepts `*.ts.net` hosts. Without Tailscale, an SSH tunnel (`ssh -N -L 5178:127.0.0.1:5178 <agent host>`) gives the same result.
- **Tests.** `node --test '<skill>/tests/*.test.mjs'` checks the data validator, the sketch layout (including a deliberately crowded fixture in `tests/fixtures/crowded.mjs`), and the sketch's proposals, rebuild merges and accept/dismiss. After changing the editor itself, run `pnpm typecheck` in an atlas home's `sketch/` (the config imports that home's `data.mjs`).

## Publishing the map

`atlas.html` is one self-contained file — no build step, no external assets beyond a Google Fonts stylesheet. Publish it whichever way the person can actually open:

- If your agent can publish a hosted HTML artifact, publish it there and keep the URL stable across rebuilds; put it in `META.artifactUrl` so the generated `SYSTEM.md` links to it.
- Otherwise serve the folder with any static server (`pnpm dlx serve`, `python3 -m http.server`) and hand over the local URL, or commit the file and let the repo's pages host serve it. If the person's browser is on another machine, wrap the port with Tailscale Serve as described under *Viewing from another machine* above. The sketch editor already serves `atlas.html`, so one mapping covers both.

Either way the rule is the same: one URL, republished after every data change, never a second copy.

## What done looks like

- `<atlas home>/data.mjs` exists and is the only edited source; `node <atlas home>/build.mjs` (or `bun`) writes `SYSTEM.md`, `atlas.html` and `atlas.excalidraw` with no errors and no legibility warnings.
- The atlas is published at a stable URL and republished there after every data change.
- Every structure has `one`, `what`, `how`, a `short` label, a role `kind`, and its questions; ghosts are marked; chapters exist with per-chapter flows; the last chapter is the whole system.
- `SYSTEM.md` carries the decisions table, the question index with IDs and states, and the "how this file is maintained" footer.
- `NOTES.md` beside `SYSTEM.md` records the atlas URL, docs paths, locked decisions with dates, what the user rejected and why, and the next step.
- After a sketch round, `fold.mjs` lists only the items the user chose to leave pending.

## Verify before publishing

Syntax-check the built script (`new Function(js)`), then look at it: serve the folder with a static server and open it in a real browser — `file://` renders as a static snapshot in some in-app browsers and the fonts may not load. Resize to ~1280×800 and screenshot a first chapter, a middle chapter, the last chapter, an inside view, and the light theme. Keep `<!doctype html>` first and `<meta charset="utf-8">` immediately after it: without the doctype the page renders in quirks mode, and without an early charset the arrows render as mojibake. Click a structure and confirm the panel says **pinned** and offers *Go inside*, and click a packet dot: this renderer rebuilds its whole scene on every draw, so a stray `render()` in a hover handler detaches the element under the cursor and the browser stops synthesising clicks — the map still looks perfect in a screenshot while nothing responds to a click. After every decision, grep the outputs for the stale words (`pending`, the old model name, the rejected design) — the person reads everything.

## Files in this skill

- `assets/template.html` — the atlas renderer (title and top-strip stats injected at build)
- `assets/build.mjs` — `data.mjs` → `atlas.html` + `SYSTEM.md` + `atlas.excalidraw`
- `assets/validate.mjs` — checks `data.mjs` before every build
- `assets/sketch.mjs` — generates and merges the Excalidraw sketch, and reads it back as proposals
- `assets/layout.mjs` — sketch layout: label-fitted boxes, scale, arrow routing, and the legibility check
- `assets/fold.mjs` — lists the user's sketch edits; settles them with `--accept`/`--dismiss`
- `assets/sketch/` — optional local Excalidraw editor (Vite + React + TypeScript, pinned versions, pnpm)
- `tests/` — validator and sketch round-trip tests (`node --test`)
- `assets/data.example.mjs` — a minimal starter with every field documented; copy to `data.mjs`
- `references/design-language.md` — layout, palette, isometric grammar, shapes by role, labels, copy rules, the chapter recipe
- `references/process-and-lessons.md` — the first session step by step, the README table, the subagent deep-dive pattern, cost-model habits, things that bit
