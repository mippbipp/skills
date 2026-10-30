// Reads the user's edits in atlas.excalidraw and proposes the matching data.mjs changes.
//   node <atlasDir>/fold.mjs                          list proposals, save them as sketch-proposal.json
//   node <atlasDir>/fold.mjs --accept 1,3 --dismiss 2 after editing data.mjs, mark items handled
//   (either flag takes "all"), then run build.mjs
// Accepted new boxes and arrows are removed from the sketch; the next build draws them from
// data.mjs. Accepted and dismissed notes stay on the canvas, dimmed. Dismissing a change to a
// generated box or arrow puts it back the way data.mjs has it on the next build.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { META, NODES, FLOWS } from './data.mjs';
import { describe, readJson, readSketch, sceneHash, sketchPaths, writeAtomic } from './sketch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sk = sketchPaths(here, META);
const scene = readJson(sk.scene), base = readJson(sk.base);
if (!scene || !base) {
  console.error(`no sketch yet: run node ${here}/build.mjs first`);
  process.exit(1);
}

const { values } = parseArgs({ options: { accept: { type: 'string' }, dismiss: { type: 'string' }, json: { type: 'boolean' } } });

if (!values.accept && !values.dismiss) {
  const { items, stale } = readSketch({ NODES, FLOWS }, scene, base);
  writeAtomic(sk.proposal, JSON.stringify({ sceneHash: sceneHash(scene), items }, null, 2));
  if (values.json) {
    console.log(JSON.stringify({ stale, items }, null, 2));
  } else {
    if (stale) console.log('note: data.mjs changed since the last build; rebuild first so this compares against current data\n');
    console.log(items.length ? items.map((it) => `${it.n}. ${describe(it)}`).join('\n') : 'no sketch edits to fold');
  }
  process.exit(0);
}

const proposal = readJson(sk.proposal);
if (!proposal || proposal.sceneHash !== sceneHash(scene)) {
  console.error('the sketch changed since the last proposal: run fold.mjs again and re-check the numbers');
  process.exit(1);
}
const pick = (s) => (s === 'all' ? proposal.items.map((i) => i.n) : (s ?? '').split(',').filter(Boolean).map(Number));
const accept = new Set(pick(values.accept)), dismiss = new Set(pick(values.dismiss));
for (const n of accept) if (dismiss.has(n)) { console.error(`item ${n} is both accepted and dismissed`); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const drop = new Set(), dim = new Map();
const resetNode = (id) => delete base.nodes[id];
const resetEdge = (from, to) => delete base.edges[`${from}>${to}`];

for (const it of proposal.items) {
  const how = accept.has(it.n) ? 'accepted' : dismiss.has(it.n) ? 'dismissed' : null;
  if (!how) continue;
  if (it.elements) {
    if (how === 'accepted' && (it.kind === 'new-node' || it.kind === 'new-edge')) it.elements.forEach((id) => drop.add(id));
    else it.elements.forEach((id) => dim.set(id, how));
  } else if (how === 'dismissed') {
    if (it.node) resetNode(it.node);
    else resetEdge(it.from, it.to);
  }
}

scene.elements = scene.elements
  .filter((e) => !drop.has(e.id))
  .map((e) => (dim.has(e.id) ? { ...e, opacity: 30, version: (e.version || 1) + 1, updated: Date.now(), customData: { ...e.customData, atlasFolded: { how: dim.get(e.id), date: today } } } : e));

writeAtomic(sk.scene, JSON.stringify(scene, null, 2));
writeAtomic(sk.base, JSON.stringify(base, null, 2));
console.log(`marked ${accept.size} accepted, ${dismiss.size} dismissed. Now run node ${here}/build.mjs`);
