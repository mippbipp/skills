// The atlas as an editable Excalidraw scene: generate it from data.mjs, merge rebuilds
// with the user's edits, and read those edits back as a proposal for data.mjs.
//
// Ownership: elements whose id starts with "atlas-" are generated; everything else is the
// user's. sketch-base.json records what the last build exported (and at which scale), so a
// three-way compare (base, data, scene) tells a pending user edit apart from a data change.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EDGE_FONT, FONT, LINE_HEIGHT, OLD_SCALE,
  boxSize, centreOf, chooseScale, layoutIssues, measure, overlaps, placeRect, routeEdges,
} from './layout.mjs';

const SNAP = 0.5; // grid positions round to half units
const PREFIX = 'atlas-';

export const isOwned = (el) => el.id.startsWith(PREFIX);
const nodeId = (id) => `${PREFIX}node-${id}`;
const labelId = (elId) => `${elId}-label`;
const edgeKey = (from, to) => `${from}>${to}`;
const edgeId = (from, to) => `${PREFIX}edge-${from}-${to}`;
const LEGEND = `${PREFIX}legend`;

export function sketchPaths(atlasHome, META) {
  const outDir = META.outDir ? join(atlasHome, META.outDir) : join(atlasHome, '..');
  return {
    outDir,
    scene: join(outDir, 'atlas.excalidraw'),
    base: join(atlasHome, 'sketch-base.json'),
    proposal: join(atlasHome, 'sketch-proposal.json'),
  };
}

export const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
export function writeAtomic(p, s) {
  writeFileSync(p + '.tmp', s);
  renameSync(p + '.tmp', p);
}
export function sceneHash(scene) {
  return String(hash(JSON.stringify(scene?.elements ?? [])));
}

// ---------- element factories ----------
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function el(id, type, props) {
  return {
    id, type, x: 0, y: 0, width: 0, height: 0, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null,
    seed: hash(id) % 2 ** 31, version: 1, versionNonce: hash(id + ':n') % 2 ** 31,
    isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
    ...props,
  };
}

// `shown` is the wrapped text Excalidraw draws; `original` is what the user typed or the data says.
function text(id, shown, props = {}, original = shown) {
  const fontSize = props.fontSize ?? FONT;
  return el(id, 'text', {
    text: shown, originalText: original, fontSize, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle',
    containerId: null, autoResize: true, lineHeight: LINE_HEIGHT, strokeWidth: 1, ...measure(shown, fontSize), ...props,
  });
}

const centerAt = (t, [cx, cy]) => ({ ...t, x: cx - t.width / 2, y: cy - t.height / 2 });

const nodeLabel = (n) => {
  const open = (n.cond || []).filter((c) => typeof c === 'string').length;
  return `${n.code} · ${n.name}` + (open ? `\n${open} open question${open > 1 ? 's' : ''}` : '');
};

// ---------- generate from data ----------
// Edges are the union of hops across FLOWS; the first hop label for a pair names it.
export function dataEdges(FLOWS, NODES) {
  const ids = new Set(NODES.map((n) => n.id));
  const edges = new Map();
  for (const f of FLOWS) for (const [from, to, label] of f.hops) {
    if (from === to || !ids.has(from) || !ids.has(to)) continue;
    const k = edgeKey(from, to);
    if (!edges.has(k)) edges.set(k, { from, to, label: String(label ?? '') });
  }
  return edges;
}

// What a build exports, in grid units. Stored as sketch-base.json together with the scale.
export function exportBase({ NODES, FLOWS }) {
  const nodes = {};
  for (const n of NODES) nodes[n.id] = { gx: n.gx, gy: n.gy, w: n.w, d: n.d, name: n.name, label: nodeLabel(n), ghost: !!n.ghost };
  const edges = {};
  for (const [k, e] of dataEdges(FLOWS, NODES)) edges[k] = e;
  return { nodes, edges };
}

const sameGeom = (a, b) => a && b && a.gx === b.gx && a.gy === b.gy && a.w === b.w && a.d === b.d;

function bump(cur, next) {
  const { version, versionNonce, updated, ...a } = cur;
  const { version: _v, versionNonce: _n, updated: _u, ...b } = next;
  if (JSON.stringify(a) === JSON.stringify(b)) return cur;
  return { ...next, version: (cur.version || 1) + 1, versionNonce: hash(next.id + ':' + (cur.version + 1)) % 2 ** 31, updated: Date.now() };
}

// Scale an element's position about the origin by f; lines and arrows scale their points too.
function rescale(e, f) {
  if (f === 1) return e;
  if (e.points) return { ...e, x: e.x * f, y: e.y * f, width: e.width * f, height: e.height * f, points: e.points.map(([x, y]) => [x * f, y * f]) };
  const [cx, cy] = centreOf(e);
  return { ...e, x: cx * f - e.width / 2, y: cy * f - e.height / 2 };
}

// Merge a rebuild into the existing scene. Per field: if data changed since the last
// build, data wins; otherwise the scene's value is kept (it may be a pending user edit).
// Returns the scene, the new base, and layout warnings a reader would notice.
export function buildScene(data, prevScene, prevBase) {
  const base = exportBase(data);
  const pb = prevBase ?? { nodes: {}, edges: {} };
  const legacy = prevBase && prevBase.scale === undefined; // built before scales: discard old generated geometry

  const sized = Object.fromEntries(Object.entries(base.nodes).map(([id, n]) => [id, { ...n, size: boxSize(n.label) }]));
  const scale = chooseScale(sized, Object.values(base.edges), legacy ? undefined : pb.scale);
  base.scale = scale;
  const f = pb.scale ? scale / pb.scale : prevBase ? scale / OLD_SCALE : 1;

  const prevEls = (prevScene?.elements ?? []).filter((e) => !e.isDeleted).map((e) => rescale(e, f));
  const byId = new Map(prevEls.map((e) => [e.id, e]));
  const owned = [];
  const rects = {};

  for (const [id, now] of Object.entries(sized)) {
    const was = legacy ? undefined : pb.nodes[id];
    const rid = nodeId(id), tid = labelId(rid);
    const cur = byId.get(rid);
    if (!cur && was && sameGeom(was, now) && was.label === now.label && was.ghost === now.ghost) continue; // user deleted it, not yet folded

    // Position: data's when the data moved (or nothing is on the canvas yet); else keep the
    // scene's centre, which may be a pending move. Size always fits the label.
    const fromData = placeRect(now, now.size, scale);
    const centre = cur && was && sameGeom(was, now) ? centreOf(cur) : centreOf(fromData);
    const geom = { x: centre[0] - now.size.width / 2, y: centre[1] - now.size.height / 2, width: now.size.width, height: now.size.height };
    const style = cur && was && was.ghost === now.ghost
      ? { strokeStyle: cur.strokeStyle, backgroundColor: cur.backgroundColor }
      : { strokeStyle: now.ghost ? 'dashed' : 'solid', backgroundColor: now.ghost ? 'transparent' : '#e9ecef' };
    const fresh = el(rid, 'rectangle', { ...geom, ...style, roundness: { type: 3 }, fillStyle: 'solid', customData: { atlas: { node: id } } });
    const rect = cur ? bump(cur, { ...cur, ...geom, ...style, customData: fresh.customData }) : fresh;

    const curLabel = byId.get(tid);
    const keepText = curLabel && was && was.label === now.label; // may be a pending rename
    const shown = keepText ? curLabel.originalText ?? curLabel.text : now.label;
    const label = centerAt(text(tid, shown, { containerId: rid }), centreOf(rect));
    rects[id] = rect;
    owned.push(rect, curLabel ? bump(curLabel, { ...curLabel, ...label, seed: curLabel.seed, versionNonce: curLabel.versionNonce }) : label);
  }

  // Route every generated arrow that is still on the canvas (or new), around boxes, labels
  // and the user's notes.
  const user = prevEls.filter((e) => !isOwned(e));
  const userRects = user.filter((e) => e.type === 'text' || ['rectangle', 'ellipse', 'diamond'].includes(e.type));
  const wanted = Object.entries(base.edges).filter(([k, e]) => rects[e.from] && rects[e.to] && (byId.has(edgeId(e.from, e.to)) || legacy || !pb.edges[k]));
  const { routes, warnings } = routeEdges(wanted.map(([, e]) => e), rects, (r) => userRects.some((u) => overlaps(r, u)));
  for (const route of routes) {
    const e = route.edge;
    const k = edgeKey(e.from, e.to);
    const aid = edgeId(e.from, e.to), tid = labelId(aid);
    const cur = byId.get(aid);
    const a = rects[e.from], b = rects[e.to];
    const userRebound = cur && !legacy && pb.edges[k] && (cur.startBinding?.elementId !== a.id || cur.endBinding?.elementId !== b.id);
    const [x0, y0] = route.path[0];
    const xs = route.path.map((p) => p[0]), ys = route.path.map((p) => p[1]);
    const arrow = el(aid, 'arrow', {
      x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      points: route.path.map(([x, y]) => [x - x0, y - y0]),
      roundness: route.sharp ? null : { type: 2 }, lastCommittedPoint: null,
      startBinding: { elementId: a.id, focus: 0, gap: 8 }, endBinding: { elementId: b.id, focus: 0, gap: 8 },
      startArrowhead: null, endArrowhead: 'arrow', elbowed: false,
      customData: { atlas: { edge: [e.from, e.to] } },
    });
    const next = cur ? (userRebound ? cur : { ...cur, ...arrow, seed: cur.seed, versionNonce: cur.versionNonce, boundElements: cur.boundElements }) : arrow;
    owned.push(cur ? bump(cur, next) : next);
    if (e.label) {
      const curLabel = byId.get(tid);
      const keep = curLabel && !legacy && pb.edges[k] && pb.edges[k].label === e.label; // may be a pending relabel
      const original = keep ? curLabel.originalText ?? curLabel.text : e.label;
      const shown = original === e.label ? route.text : original;
      const t = centerAt(text(tid, shown, { containerId: aid, fontSize: EDGE_FONT }, original), route.labelAt);
      owned.push(curLabel ? bump(curLabel, { ...curLabel, ...t, seed: curLabel.seed, versionNonce: curLabel.versionNonce }) : t);
    }
  }

  const all = [...owned, ...user];
  const present = new Set(all.map((e) => e.id));
  // Bound-element lists must name every arrow/text attached, including the user's arrows.
  const attached = new Map();
  for (const e of all) {
    const add = (target, type) => {
      if (!target) return;
      if (!attached.has(target)) attached.set(target, []);
      attached.get(target).push({ type, id: e.id });
    };
    if (e.type === 'arrow') { add(e.startBinding?.elementId, 'arrow'); add(e.endBinding?.elementId, 'arrow'); }
    if (e.type === 'text' && e.containerId) add(e.containerId, 'text');
  }
  const out = all.map((e) => {
    if (!isOwned(e)) return e;
    const be = (attached.get(e.id) ?? []).filter((b) => present.has(b.id));
    const uniq = [...new Map(be.map((b) => [b.id, b])).values()];
    return JSON.stringify(uniq) === JSON.stringify(e.boundElements ?? []) ? e : bump(e, { ...e, boundElements: uniq });
  });

  const box = out.filter((e) => e.type === 'rectangle' && isOwned(e));
  const minX = Math.min(...box.map((e) => e.x)), minY = Math.min(...box.map((e) => e.y));
  const legendText =
    `${data.META.title} · sketch (generated from data.mjs; your additions are kept on rebuild)\n` +
    'Plain box + label = new structure (dashed = not built yet) · filled box or loose text = note/question\n' +
    'Arrow between boxes = flow · move, rename, dash or delete a box to propose that change · "Q-I1: answer" resolves a question';
  const legendBase = text(LEGEND, legendText, { fontSize: 14, textAlign: 'left', strokeColor: '#868e96' });
  const legend = { ...legendBase, x: minX, y: minY - legendBase.height - 48 };
  const prevLegend = byId.get(LEGEND);

  const elements = [prevLegend ? bump(prevLegend, { ...legend, seed: prevLegend.seed, versionNonce: prevLegend.versionNonce }) : legend, ...out];
  return {
    scene: {
      type: 'excalidraw', version: 2, source: 'system-atlas',
      elements,
      appState: prevScene?.appState ?? { viewBackgroundColor: '#ffffff', gridSize: null },
      files: prevScene?.files ?? {},
    },
    base,
    warnings: [...warnings, ...layoutIssues(elements)],
  };
}

// ---------- read the user's edits ----------
const isShape = (e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type);
const words = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ownText = (t) => (t ? t.originalText ?? t.text : '');
const firstLine = (s) => String(s ?? '').split('\n')[0].trim();
const stripCode = (s, code) => s.replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*·\\s*`), '');
const sameBase = (a, b) => JSON.stringify({ nodes: a.nodes, edges: a.edges }) === JSON.stringify({ nodes: b.nodes, edges: b.edges });

function distToRect(p, r) {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.width)), dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.height));
  return Math.hypot(dx, dy);
}

// Returns { items, stale } where each item is one proposed change to data.mjs.
export function readSketch(data, scene, base) {
  const items = [];
  const els = (scene?.elements ?? []).filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  const codeOf = Object.fromEntries(data.NODES.map((n) => [n.id, n.code]));
  const stale = !sameBase(exportBase(data), base);
  const s = base.scale ?? OLD_SCALE;
  const snap = (v) => Math.round(v / s / SNAP) * SNAP;
  const boundText = (e) => els.find((t) => t.type === 'text' && t.containerId === e.id);

  // Changes to generated structures. A box's grid position is its footprint centre.
  const anchors = []; // rects a note or arrow can attach to: [ref, element]
  for (const [id, b] of Object.entries(base.nodes)) {
    const rect = byId.get(nodeId(id));
    if (!rect) { items.push({ kind: 'remove-node', node: id }); continue; }
    anchors.push([id, rect]);
    const [cx, cy] = centreOf(rect);
    const to = { gx: Math.round((cx / s - b.w / 2) / SNAP) * SNAP, gy: Math.round((cy / s - b.d / 2) / SNAP) * SNAP, w: b.w, d: b.d };
    if (!sameGeom(b, to)) items.push({ kind: 'move', node: id, from: { gx: b.gx, gy: b.gy, w: b.w, d: b.d }, to });
    const name = stripCode(firstLine(ownText(byId.get(labelId(rect.id)) ?? boundText(rect))), codeOf[id] ?? id);
    if (name && name !== b.name) items.push({ kind: 'rename', node: id, from: b.name, to: name });
    const ghost = rect.strokeStyle !== 'solid';
    if (ghost !== b.ghost) items.push({ kind: 'ghost', node: id, to: ghost });
  }
  const refOf = new Map(anchors.map(([id, r]) => [r.id, id]));

  for (const [, e] of Object.entries(base.edges)) {
    const arrow = byId.get(edgeId(e.from, e.to));
    if (!arrow) { items.push({ kind: 'remove-edge', from: e.from, to: e.to }); continue; }
    const from = refOf.get(arrow.startBinding?.elementId), to = refOf.get(arrow.endBinding?.elementId);
    if (from !== e.from || to !== e.to) items.push({ kind: 'reroute-edge', from: e.from, to: e.to, now: { from: from ?? null, to: to ?? null } });
    const label = words(ownText(byId.get(labelId(arrow.id)) ?? boundText(arrow)));
    if (label && label !== words(e.label)) items.push({ kind: 'relabel-edge', from: e.from, to: e.to, label });
  }

  // The user's own elements. Folded ones were already handled.
  const user = els.filter((e) => !isOwned(e) && !e.customData?.atlasFolded);
  const nearest = (e) => {
    const p = centreOf(e);
    let best = null, bestD = 2 * s;
    for (const [ref, r] of anchors) { const d = distToRect(p, r); if (d <= bestD) { best = ref; bestD = d; } }
    return best;
  };

  for (const e of user.filter(isShape)) {
    const label = ownText(boundText(e)).trim();
    const elements = [e.id, ...(boundText(e) ? [boundText(e).id] : [])];
    if (e.backgroundColor && e.backgroundColor !== 'transparent') {
      if (label) items.push(noteItem(label, nearest(e), elements, data));
      continue;
    }
    const ref = `new-${anchors.filter(([r]) => r.startsWith('new-')).length + 1}`;
    anchors.push([ref, e]);
    refOf.set(e.id, ref);
    const w = Math.max(1, snap(e.width)), d = Math.max(1, snap(e.height));
    const [cx, cy] = centreOf(e);
    items.push({ kind: 'new-node', ref, name: label || null, ghost: e.strokeStyle !== 'solid', gx: Math.round((cx / s - w / 2) / SNAP) * SNAP, gy: Math.round((cy / s - d / 2) / SNAP) * SNAP, w, d, elements });
  }

  for (const e of user.filter((e) => e.type === 'arrow' || e.type === 'line')) {
    const label = ownText(boundText(e)).trim();
    const elements = [e.id, ...(boundText(e) ? [boundText(e).id] : [])];
    const pts = e.points ?? [[0, 0]];
    const nearestPoint = (p) => anchors.find(([, r]) => distToRect(p, r) <= s / 2)?.[0] ?? null;
    const endAt = (binding, pt) => refOf.get(binding?.elementId) ?? nearestPoint([e.x + pt[0], e.y + pt[1]]);
    const from = endAt(e.startBinding, pts[0]), to = endAt(e.endBinding, pts[pts.length - 1]);
    if (from && to && from !== to) items.push({ kind: 'new-edge', from, to, label: label || null, elements });
    else if (label) items.push(noteItem(label, from ?? to ?? nearest(e), elements, data));
    else items.push({ kind: 'drawing', near: from ?? to ?? nearest(e), elements, what: 'loose arrow' });
  }

  for (const e of user.filter((e) => e.type === 'text' && !e.containerId)) {
    const t = ownText(e).trim();
    if (t) items.push(noteItem(t, nearest(e), [e.id], data));
  }

  for (const e of user.filter((e) => !isShape(e) && !['arrow', 'line', 'text'].includes(e.type))) {
    items.push({ kind: 'drawing', near: nearest(e), elements: [e.id], what: e.type });
  }

  return { items: items.map((it, i) => ({ n: i + 1, ...it })), stale };
}

const QREF = /^\s*Q-([A-Za-z]+)(\d+)\s*[:\-–]\s*([\s\S]+)$/i;
function noteItem(text, near, elements, data) {
  const m = text.match(QREF);
  if (m) {
    // Case-insensitive: "q-b1:" and "Q-b1:" both answer Q-B1. The ID is reported in the node's own casing.
    const node = data.NODES.find((n) => n.code.toLowerCase() === m[1].toLowerCase());
    const c = node?.cond?.[Number(m[2]) - 1];
    return { kind: 'resolve', qid: `Q-${node?.code ?? m[1].toUpperCase()}${m[2]}`, question: c ? (typeof c === 'string' ? c : c.q) : null, answer: words(m[3]), elements };
  }
  return { kind: 'question', node: near, text: words(text), elements };
}

// Scene element ids an item refers to, so an editor can select them.
export function itemElements(it) {
  if (it.elements) return it.elements;
  if (it.node) return [nodeId(it.node)];
  if (it.from && it.to) return [edgeId(it.from, it.to)];
  return [];
}

// ---------- describe ----------
const g = (p) => `gx ${p.gx}, gy ${p.gy}`;
export function describe(it) {
  switch (it.kind) {
    case 'move': return `${it.node}: move to ${g(it.to)} (was ${g(it.from)})`;
    case 'rename': return `${it.node}: rename "${it.from}" → "${it.to}"`;
    case 'ghost': return `${it.node}: ${it.to ? 'mark as ghost (not built)' : 'mark as built (not a ghost)'}`;
    case 'remove-node': return `${it.node}: deleted from the sketch, remove the structure?`;
    case 'remove-edge': return `${it.from} → ${it.to}: arrow deleted, remove these hops from FLOWS/CH?`;
    case 'reroute-edge': return `${it.from} → ${it.to}: arrow now runs ${it.now.from ?? '?'} → ${it.now.to ?? '?'}`;
    case 'relabel-edge': return `${it.from} → ${it.to}: hop label now "${it.label}"`;
    case 'new-node': return `new structure ${it.ref}${it.name ? ` "${it.name}"` : ' (unnamed)'}${it.ghost ? ', ghost' : ''} at ${g(it)}, footprint ${it.w}×${it.d}`;
    case 'new-edge': return `new flow hop ${it.from} → ${it.to}${it.label ? ` "${it.label}"` : ''}`;
    case 'resolve': return `${it.qid}: resolve with "${it.answer}"${it.question ? ` (question: ${it.question})` : ' (no such question)'}`;
    case 'question': return `${it.node ? `question on ${it.node}` : 'unattached note'}: "${it.text}"`;
    case 'drawing': return `${it.what}${it.near ? ` near ${it.near}` : ''}, look at the sketch`;
    default: return JSON.stringify(it);
  }
}
