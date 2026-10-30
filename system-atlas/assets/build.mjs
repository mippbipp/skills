// Builds <outDir>/SYSTEM.md, <outDir>/atlas.html and <outDir>/atlas.excalidraw from data.mjs (same folder).
// Usage: node <atlasDir>/build.mjs (or bun)   — outDir = parent of atlasDir by default, or META.outDir
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META, DECISIONS, GROUPS, NODES, FLOWS, CH, HOW_HTML } from './data.mjs';
import { buildScene, readJson, readSketch, sketchPaths, writeAtomic } from './sketch.mjs';
import { isoWarnings, validate } from './validate.mjs';

const problems = validate({ META, DECISIONS, GROUPS, NODES, FLOWS, CH });
if (problems.length) {
  console.error(`data.mjs has ${problems.length} problem${problems.length > 1 ? 's' : ''}; nothing was written:\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = META.outDir ? join(here, META.outDir) : join(here, '..');

// ---------- shared helpers ----------
const Q = (c) => (typeof c === 'string' ? { q: c } : c);
const md = (s) =>
  String(s)
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<mark>(.*?)<\/mark>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '_$1_')
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
const groupTitle = Object.fromEntries(GROUPS.map((g) => [g.id, g.title]));
const cnt = { open: 0, res: 0 };
NODES.forEach((n) => (n.cond || []).map(Q).forEach((c) => (c.r || c.to ? cnt.res++ : cnt.open++)));

// ---------- SYSTEM.md ----------
function buildSystemMd() {
  const out = [];
  out.push(`# ${META.title} — System Definition`, '');
  if (META.intro) out.push(META.intro, '');
  out.push(`_Question status: **${cnt.open} open · ${cnt.res} resolved**._`, '');
  out.push('## One paragraph', '', META.onePara, '');
  out.push('## Decisions locked', '', '| Axis | Decision | ADR |', '|---|---|---|');
  DECISIONS.forEach((d) => out.push(`| ${d.axis} | ${d.decision} | ${d.adr} |`));
  out.push('');
  out.push('## Cost model', '');
  (META.costModel ?? []).forEach((l) => out.push(l));
  if (META.deepDive) out.push('## Deep dives', '', META.deepDive, '');
  out.push('## Reading order (the atlas chapters)', '');
  CH.forEach((c, i) => out.push(`${i + 1}. **${c.title}** — ${md(c.lede)}${c.reveal.length ? ` _(adds ${c.reveal.join(', ')})_` : ''}`));
  out.push('');
  out.push('## Structures', '');
  const index = [];
  for (const g of GROUPS) {
    out.push(`### ${g.title}${g.id === 'off' ? ' (designed for, not built)' : ''}`, '');
    for (const n of NODES.filter((n) => n.group === g.id)) {
      out.push(`#### ${n.code} · ${n.name}${n.ghost ? ' _(not switched on)_' : ''}`, '');
      out.push(`**In one line.** ${md(n.one)}`, '');
      out.push(`**What it does.** ${md(n.what)}`, '');
      out.push(`**How it's built.** ${md(n.how)}`, '');
      if (n.steps) {
        out.push('**Steps in execution.**', '');
        n.steps.forEach((s, i) => out.push(`${i + 1}. **${s[0]}** — ${s[1]}`));
        out.push('');
      }
      const cs = (n.cond || []).map(Q);
      if (cs.length) {
        out.push('**Questions.**', '');
        cs.forEach((c, i) => {
          const id = `Q-${n.code}${i + 1}`;
          out.push(c.r ? `- ~~**${id}** ${md(c.q)}~~ ✓ ${md(c.r)}` : c.to ? `- **${id}** ${md(c.q)} → _${md(c.to)}_` : `- **${id}** ${md(c.q)}`);
          index.push([id, n.code, c]);
        });
        out.push('');
      }
    }
  }
  out.push('## Flows (representative packets)', '', 'Payload shapes are what the design implies, not measured traffic.', '');
  for (const f of FLOWS) {
    out.push(`### ${f.name}`, '', '| # | From → To | Packet | Representative payload |', '|---|---|---|---|');
    f.hops.forEach((h, i) => out.push(`| ${i + 1} | ${h[0]} → ${h[1]} | ${h[2]} | \`${JSON.stringify(h[3]).replace(/\|/g, '\\|')}\` |`));
    out.push('');
  }
  out.push('## Questions — index', '', 'Reference by ID. ✓ resolved (with date) · otherwise open.', '');
  index.forEach(([id, code, c]) => out.push(c.r ? `- ~~**${id}**~~ (${code}) ✓ ${md(c.r)}` : `- **${id}** (${code}) ${md(c.q)}`));
  out.push('');
  if (META.platformGives || META.weOwn) out.push('## What the platform gives vs what we own', '', `**Platform gives:** ${META.platformGives||''}`, '', `**We own:** ${META.weOwn||''}`, '');
  if (META.filesystem) out.push('## Planned filesystem', '', '```', META.filesystem.trimEnd(), '```', '');
  out.push('## How this file is maintained', '', `Generated from \`${META.sourcePath||'atlas/data.mjs'}\` by \`${META.buildCmd||'node atlas/build.mjs'}\`, which also builds the interactive atlas (\`atlas.html\`${META.artifactUrl?`, published at ${META.artifactUrl}`:''}). Edit the data file, rebuild, republish — never edit this file by hand.`, '');
  return out.join('\n');
}

// ---------- atlas.html ----------
function buildAtlasHtml() {
  const tpl = readFileSync(join(here, 'template.html'), 'utf8');
  const decisionsHtml = DECISIONS.map((d) => `<li><b>${d.axis}.</b> ${md(d.decision).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/`(.*?)`/g, '<code>$1</code>').replace(/\[(.*?)\]\((.*?)\)/g, '$1')}</li>`).join('');
  const data = [
    `const GROUPS = ${JSON.stringify(GROUPS)};`,
    `const NODES = ${JSON.stringify(NODES)};`,
    `const FLOWS = ${JSON.stringify(FLOWS)};`,
    `const CH = ${JSON.stringify(CH)};`,
    `const HOW_HTML = ${JSON.stringify(HOW_HTML)};`,
    `const DECISIONS_HTML = ${JSON.stringify(decisionsHtml)};`,
  ].join('\n');
  return tpl.replace('__TITLE__', META.title + ' Atlas').replace('/*__DATA__*/', data + `\nconst STATS = ${JSON.stringify(META.stats||[])};\nconst TITLE = ${JSON.stringify(META.title||'System')};`);
}

writeFileSync(join(outDir, 'SYSTEM.md'), buildSystemMd());
writeFileSync(join(outDir, 'atlas.html'), buildAtlasHtml());

// atlas.excalidraw: regenerate the generated elements, keep the user's sketching.
const sk = sketchPaths(here, META);
const { scene, base, warnings: sketchWarnings } = buildScene({ META, NODES, FLOWS }, readJson(sk.scene), readJson(sk.base));
writeAtomic(sk.scene, JSON.stringify(scene, null, 2));
writeAtomic(sk.base, JSON.stringify(base, null, 2));
const pending = readSketch({ NODES, FLOWS }, scene, base).items.length;
// Not fatal (the files are written), but a legible atlas has none of these.
const warnings = [...isoWarnings({ NODES }), ...sketchWarnings.map((w) => `sketch: ${w}`)];
if (warnings.length) console.warn(`${warnings.length} legibility warning${warnings.length > 1 ? 's' : ''}:\n` + warnings.map((w) => `  - ${w}`).join('\n'));

console.log(`built SYSTEM.md + atlas.html + atlas.excalidraw · ${cnt.open} open · ${cnt.res} resolved · ${NODES.length} structures · ${DECISIONS.length} decisions${pending ? ` · ${pending} unfolded sketch edits (node ${join(here, 'fold.mjs')})` : ''}`);
