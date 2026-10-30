// Layout for the Excalidraw sketch, with no Node imports so the editor page can load it too.
// Boxes are sized to their labels (measured with Excalifont's real advance widths), placed
// by footprint centre at a scale chosen so nothing overlaps, and arrows are routed so their
// labels stay clear of boxes and of each other.

export const FONT = 16;
export const EDGE_FONT = 14;
export const LINE_HEIGHT = 1.25;
const TEXT_PAD = 5; // Excalidraw's BOUND_TEXT_PADDING
const BOX_PAD_X = 22, BOX_PAD_Y = 16, MIN_BOX_W = 160, MIN_BOX_H = 72;
const BOX_GAP = 56; // clear space between any two boxes
const LABEL_ROOM = 24; // clear space before and after an arrow label along its arrow
export const ARROW_GAP = 8;
export const OLD_SCALE = 60; // px per grid unit before scales were chosen per atlas
const SCALES = Array.from({ length: 35 }, (_, i) => 60 + i * 10); // 60…400

// Excalifont advance widths per 1px of font size, for ' '…'~' then '·→…–—' (measured in Chromium).
const CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·→…–—';
const WIDTHS = [0.4,0.31,0.37,0.78,0.72,0.93,0.72,0.22,0.44,0.4,0.52,0.55,0.26,0.41,0.27,0.56,0.66,0.43,0.7,0.61,0.58,0.62,0.64,0.56,0.64,0.63,0.26,0.3,0.55,0.55,0.55,0.47,0.83,0.68,0.76,0.63,0.78,0.71,0.66,0.78,0.57,0.54,0.57,0.61,0.54,0.77,0.63,0.77,0.7,0.77,0.74,0.62,0.86,0.73,0.59,0.79,0.63,0.56,0.83,0.47,0.59,0.5,0.51,0.67,0.6,0.58,0.55,0.5,0.6,0.54,0.5,0.55,0.57,0.24,0.33,0.53,0.22,0.66,0.53,0.6,0.54,0.54,0.41,0.54,0.55,0.55,0.52,0.69,0.59,0.53,0.57,0.5,0.3,0.54,0.67,0.2,0.84,0.71,0.7,0.93];
const ADVANCE = new Map([...CHARS].map((c, i) => [c, WIDTHS[i]]));
const UNKNOWN = 0.8; // wide fallback, so unmeasured characters err towards roomier boxes

export function measure(str, fontSize) {
  const lines = String(str).split('\n');
  const width = Math.max(...lines.map((l) => [...l].reduce((w, c) => w + (ADVANCE.get(c) ?? UNKNOWN), 0))) * fontSize;
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}

export function wrap(str, maxWidth, fontSize) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, fontSize).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function boxSize(label) {
  const t = measure(label, FONT);
  const even = (v) => Math.ceil(v / 2) * 2;
  return { width: even(Math.max(MIN_BOX_W, t.width + 2 * (BOX_PAD_X + TEXT_PAD))), height: even(Math.max(MIN_BOX_H, t.height + 2 * BOX_PAD_Y)) };
}

// ---------- geometry ----------
export const centreOf = (r) => [r.x + r.width / 2, r.y + r.height / 2];
const inflate = (r, p) => ({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p });
export const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function segmentHitsRect(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - r.x], [dx, r.x + r.width - p[0]], [-dy, p[1] - r.y], [dy, r.y + r.height - p[1]]]) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1;
}
const pathHitsRect = (pts, r) => pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, r));

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const pathsCross = (p, q) => p.some((a, i) => i > 0 && q.some((c, j) => j > 0 && segmentsCross(p[i - 1], a, q[j - 1], c)));

// Distance from a rect's centre to its border along unit direction u.
const halfSpan = (r, u) => Math.min(u[0] ? r.width / 2 / Math.abs(u[0]) : Infinity, u[1] ? r.height / 2 / Math.abs(u[1]) : Infinity);

// Where the ray from the rect's centre towards (tx,ty) leaves it, pushed out by ARROW_GAP.
function exitPoint(r, t) {
  const c = centreOf(r);
  const dx = t[0] - c[0], dy = t[1] - c[1];
  const len = Math.hypot(dx, dy);
  if (!len) return c;
  const u = [dx / len, dy / len];
  const s = halfSpan(r, u) + ARROW_GAP;
  return [c[0] + u[0] * s, c[1] + u[1] * s];
}

// ---------- scale ----------
// Footprint centre at scale s; size from the label.
export const placeRect = (geom, size, s) => ({
  x: (geom.gx + geom.w / 2) * s - size.width / 2,
  y: (geom.gy + geom.d / 2) * s - size.height / 2,
  width: size.width,
  height: size.height,
});

export const edgeLabelText = (label) => wrap(label, EDGE_FONT * 11, EDGE_FONT); // Excalidraw's minimum arrow-label width

function fitsAt(nodes, edges, s) {
  const rects = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, placeRect(n, n.size, s)]));
  const list = Object.values(rects);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlaps(inflate(list[i], BOX_GAP / 2), inflate(list[j], BOX_GAP / 2))) return false;
  for (const e of edges) {
    const a = rects[e.from], b = rects[e.to];
    if (!a || !b || !e.label) continue;
    const ac = centreOf(a), bc = centreOf(b);
    const len = Math.hypot(bc[0] - ac[0], bc[1] - ac[1]);
    const u = [(bc[0] - ac[0]) / len, (bc[1] - ac[1]) / len];
    const t = measure(edgeLabelText(e.label), EDGE_FONT);
    const along = Math.abs(u[0]) * t.width + Math.abs(u[1]) * t.height;
    if (len - halfSpan(a, u) - halfSpan(b, u) - 2 * ARROW_GAP < along + 2 * LABEL_ROOM) return false;
  }
  return true;
}

// Smallest scale at which boxes keep their gap and every labelled arrow has room for its label.
// Keeps the previous scale while it still fits and is not much larger than needed, so a small
// data change does not move every box.
export function chooseScale(nodes, edges, prev) {
  const need = SCALES.find((s) => fitsAt(nodes, edges, s)) ?? SCALES[SCALES.length - 1];
  if (prev && prev >= need && prev <= need * 1.25 && fitsAt(nodes, edges, prev)) return prev;
  return need;
}

// ---------- arrows ----------
// Candidate arrows bow sideways from the straight line; opposite-direction pairs bow to
// opposite sides so their labels never share a midpoint.
export function routeEdges(edges, rects, isBlocked = () => false) {
  const placed = [];
  const warnings = [];
  const keys = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const boxes = Object.entries(rects);
  const dist = (e) => (rects[e.from] && rects[e.to] ? Math.hypot(...centreOf(rects[e.from]).map((v, i) => v - centreOf(rects[e.to])[i])) : 0);
  // Short arrows first: they have the fewest ways around, long ones can detour.
  const order = [...edges].sort((x, y) => dist(x) - dist(y) || `${x.from}>${x.to}`.localeCompare(`${y.from}>${y.to}`));
  for (const e of order) {
    const a = rects[e.from], b = rects[e.to];
    if (!a || !b) continue;
    const pair = keys.has(`${e.to}>${e.from}`);
    const [lo, hi] = e.from < e.to ? [a, b] : [b, a];
    const lc = centreOf(lo), hc = centreOf(hi);
    const len = Math.hypot(hc[0] - lc[0], hc[1] - lc[1]) || 1;
    const n = [-(hc[1] - lc[1]) / len, (hc[0] - lc[0]) / len]; // same normal for both directions of a pair
    const sign = e.from < e.to ? 1 : -1;
    const steps = pair ? [1, 2, 3, 4, 5].map((k) => sign * k * 34) : [0, 40, -40, 80, -80, 120, -120, 170, -170];
    let best = null;
    const consider = (cand, off) => {
      let cost = 0;
      const hits = [];
      for (const [id, r] of boxes) {
        if (id !== e.from && id !== e.to && pathHitsRect(cand.path, inflate(r, 12))) { cost += 4; hits.push(id); }
        if (cand.labelRect && overlaps(cand.labelRect, inflate(r, 6))) { cost += 4; hits.push(id); }
      }
      for (const p of placed) {
        if (cand.labelRect && p.labelRect && overlaps(cand.labelRect, inflate(p.labelRect, 6))) cost += 3;
        if (cand.labelRect && pathHitsRect(p.path, cand.labelRect)) cost += 3;
        if (p.labelRect && pathHitsRect(cand.path, p.labelRect)) cost += 3;
        if (pathsCross(cand.path, p.path)) cost += 0.5;
      }
      if (cand.labelRect && isBlocked(cand.labelRect)) cost += 2;
      cost += off / 1000 + (cand.path.length - 2) * 0.05; // prefer straighter, simpler arrows among equals
      if (!best || cost < best.cost) best = { ...cand, cost, hits, edge: e };
    };
    for (const off of steps) {
      consider(arrowCandidate(a, b, n, off, e.label), Math.abs(off));
      if (best.cost < 0.5) break;
    }
    // Still blocked: route orthogonally through the channels between boxes.
    if (best.cost >= 0.5) {
      const path = orthogonalRoute(a, b, Object.values(rects), placed);
      const clear = (lr) => !boxes.some(([, r]) => overlaps(lr, inflate(r, 6))) && !placed.some((p) => (p.labelRect && overlaps(lr, inflate(p.labelRect, 6))) || pathHitsRect(p.path, lr)) && !isBlocked(lr);
      if (path) consider(polylineCandidate(path, e.label, clear), 0);
    }
    if (best.cost >= 2) warnings.push(`${e.from} → ${e.to}: no clean route${best.hits.length ? ` (crosses ${[...new Set(best.hits)].join(', ')})` : ''}; move a structure in data.mjs or in the sketch`);
    placed.push(best);
  }
  return { routes: placed, warnings };
}

function labelBox(text, at) {
  if (!text) return { text: '', size: null, labelRect: null };
  const size = measure(text, EDGE_FONT);
  return { text, size, labelRect: { x: at[0] - size.width / 2 - 4, y: at[1] - size.height / 2 - 3, width: size.width + 8, height: size.height + 6 } };
}

function arrowCandidate(a, b, n, off, label) {
  const ac = centreOf(a), bc = centreOf(b);
  const mid = [(ac[0] + bc[0]) / 2 + n[0] * off, (ac[1] + bc[1]) / 2 + n[1] * off];
  const start = exitPoint(a, off ? mid : bc), end = exitPoint(b, off ? mid : ac);
  const path = off ? [start, mid, end] : [start, end];
  const labelAt = off ? mid : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const xs = path.map((p) => p[0]);
  const bboxWidth = Math.max(...xs) - Math.min(...xs);
  const text = label ? wrap(label, Math.max(0.7 * bboxWidth, EDGE_FONT * 11), EDGE_FONT) : '';
  return { path, labelAt, sharp: false, ...labelBox(text, labelAt) };
}

// ---------- orthogonal routes ----------
// A* over a grid whose lines run beside every box (in the channels between them). Boxes
// other than the two ends are walls; crossing an already placed label or arrow costs extra,
// and so does every bend. Returns a sharp polyline from a's border to b's border.
function orthogonalRoute(a, b, rects, placed) {
  const G = BOX_GAP / 2;
  const walls = rects.filter((r) => r !== a && r !== b).map((r) => inflate(r, 14));
  const ends = [a, b].map((r) => inflate(r, 2));
  const ac = centreOf(a), bc = centreOf(b);
  const lines = (pick) => {
    const v = new Set([pick(ac), pick(bc)]);
    for (const r of rects) for (const q of pick === X ? [r.x - G, r.x + r.width + G] : [r.y - G, r.y + r.height + G]) v.add(Math.round(q));
    const sorted = [...v].sort((p, q) => p - q);
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 2 * G) v.add(Math.round((sorted[i] + sorted[i - 1]) / 2));
    return [...v].sort((p, q) => p - q);
  };
  const X = (p) => Math.round(p[0]), Y = (p) => Math.round(p[1]);
  const xs = lines(X), ys = lines(Y);
  const inside = (p, r) => p[0] > r.x && p[0] < r.x + r.width && p[1] > r.y && p[1] < r.y + r.height;
  const start = [X(ac), Y(ac)], goal = [X(bc), Y(bc)];
  const key = (p, dir) => `${p[0]},${p[1]},${dir}`;
  const blocked = (p, q) => walls.some((w) => segmentHitsRect(p, q, w));
  // Leaving an end box is fine only on the first or last leg.
  const reentersEnd = (p, q) => ends.some((r, i) => { const c = i ? goal : start; return !(p[0] === c[0] && p[1] === c[1]) && !(q[0] === c[0] && q[1] === c[1]) && segmentHitsRect(p, q, r); });
  const softCost = (p, q) => {
    let c = 0;
    for (const o of placed) {
      if (o.labelRect && segmentHitsRect(p, q, inflate(o.labelRect, 4))) c += 900;
      if (pathsCross([p, q], o.path)) c += 60;
    }
    return c;
  };
  const insideEnd = (q) => ends.some((r, i) => { const c = i ? goal : start; return !(q[0] === c[0] && q[1] === c[1]) && inside(q, r); });
  const neighbours = (p) => {
    const out = [];
    const xi = xs.indexOf(p[0]), yi = ys.indexOf(p[1]);
    // Step to the next grid line in each direction, skipping lines that fall inside an end box.
    for (const [dir, axis, stepDir] of [[0, 0, 1], [1, 0, -1], [2, 1, 1], [3, 1, -1]]) {
      const values = axis ? ys : xs;
      let i = (axis ? yi : xi) + stepDir, q;
      for (; i >= 0 && i < values.length; i += stepDir) {
        q = axis ? [p[0], values[i]] : [values[i], p[1]];
        if (!insideEnd(q)) break;
      }
      if (i < 0 || i >= values.length) continue;
      if (walls.some((w) => inside(q, w)) || blocked(p, q) || reentersEnd(p, q)) continue;
      out.push([dir, q]);
    }
    return out;
  };
  const h = (p) => Math.abs(p[0] - goal[0]) + Math.abs(p[1] - goal[1]);
  const open = new Heap();
  open.push([h(start), 0, start, -1, null]);
  const seen = new Map();
  let found = null;
  while (open.size) {
    const [, g, p, dir, prev] = open.pop();
    const k = key(p, dir);
    if (seen.has(k)) continue;
    const node = { p, prev };
    seen.set(k, node);
    if (p[0] === goal[0] && p[1] === goal[1]) { found = node; break; }
    if (seen.size > 20000) break;
    for (const [d, q] of neighbours(p)) {
      const step = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + (dir >= 0 && d !== dir ? 80 : 0) + softCost(p, q);
      if (!seen.has(key(q, d))) open.push([g + step + h(q), g + step, q, d, node]);
    }
  }
  if (!found) return null;
  const pts = [];
  for (let n = found; n; n = n.prev) pts.unshift(n.p);
  const path = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1][0] === p[0] && p[0] === pts[i + 1][0]) || (pts[i - 1][1] === p[1] && p[1] === pts[i + 1][1])));
  if (path.length < 2) return null;
  // Trim the ends back to the box borders.
  const clip = (inner, outer, r) => {
    const u = [Math.sign(outer[0] - inner[0]), Math.sign(outer[1] - inner[1])];
    const s = halfSpan(r, u) + ARROW_GAP;
    return [inner[0] + u[0] * s, inner[1] + u[1] * s];
  };
  path[0] = clip(path[0], path[1], a);
  path[path.length - 1] = clip(path[path.length - 1], path[path.length - 2], b);
  return path;
}

// Where Excalidraw draws the label of a sharp polyline: the middle point for an odd count,
// the middle of the middle segment for an even count. Pad with collinear points so the
// label lands on the leg that has room for it.
function polylineCandidate(path, label, clear) {
  const segs = path.length - 1;
  const tries = [...Array(segs).keys()].sort((i, j) => Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]) - Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]));
  let fallback = null;
  for (const j of tries) {
    const padded = padSoMiddle(path, j);
    const i = padded.length / 2 - 1;
    const labelAt = [(padded[i][0] + padded[i + 1][0]) / 2, (padded[i][1] + padded[i + 1][1]) / 2];
    const xs = padded.map((p) => p[0]);
    const text = label ? wrap(label, Math.max(0.7 * (Math.max(...xs) - Math.min(...xs)), EDGE_FONT * 11), EDGE_FONT) : '';
    const cand = { path: padded, labelAt, sharp: true, ...labelBox(text, labelAt) };
    if (!cand.labelRect || clear(cand.labelRect)) return cand;
    fallback ??= cand;
  }
  return fallback;
}

// Insert collinear points so segment j of `path` becomes the middle one of an even-length path.
function padSoMiddle(path, j) {
  const split = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const out = path.map((p) => [...p]);
  let before = j, after = path.length - 2 - j;
  while (before < after) { out.splice(1, 0, split(out[0], out[1])); before++; }
  while (after < before) { const n = out.length; out.splice(n - 1, 0, split(out[n - 2], out[n - 1])); after++; }
  return out;
}

// Minimal binary min-heap on entry[0].
class Heap {
  #a = [];
  get size() { return this.#a.length; }
  push(v) {
    const a = this.#a;
    a.push(v);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.#a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------- checking a scene ----------
// Problems a reader would notice: text spilling out of its box, boxes on top of each other,
// labels on boxes or on each other, arrows through boxes or labels. Works on Excalidraw
// elements, so the editor page can run it on font-measured sizes.
export function layoutIssues(elements) {
  const els = elements.filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  const r = (e) => ({ x: e.x, y: e.y, width: e.width, height: e.height });
  const boxes = els.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
  const texts = els.filter((e) => e.type === 'text');
  const arrows = els.filter((e) => e.type === 'arrow');
  const labels = texts.filter((t) => byId.get(t.containerId)?.type === 'arrow');
  const loose = texts.filter((t) => !t.containerId);
  const pathOf = (a) => a.points.map(([x, y]) => [a.x + x, a.y + y]);
  const name = (t) => `"${String(t.originalText ?? t.text).replace(/\s+/g, ' ')}"`;
  const issues = [];
  for (const t of texts) {
    const c = byId.get(t.containerId);
    if (!c || c.type === 'arrow') continue;
    const inner = inflate(r(c), 1);
    if (t.x < inner.x || t.y < inner.y || t.x + t.width > inner.x + inner.width || t.y + t.height > inner.y + inner.height) issues.push(`text overflows box ${c.id}: ${name(t)}`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(r(boxes[i]), r(boxes[j]))) issues.push(`boxes overlap: ${boxes[i].id} × ${boxes[j].id}`);
  for (const l of labels) {
    for (const b of boxes) if (overlaps(r(l), inflate(r(b), 2))) issues.push(`arrow label ${name(l)} overlaps box ${b.id}`);
    for (const t of loose) if (overlaps(r(l), r(t))) issues.push(`arrow label ${name(l)} overlaps text ${t.id}`);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlaps(inflate(r(labels[i]), 2), r(labels[j]))) issues.push(`arrow labels overlap: ${name(labels[i])} × ${name(labels[j])}`);
  for (const a of arrows) {
    const ends = new Set([a.startBinding?.elementId, a.endBinding?.elementId]);
    const path = pathOf(a);
    for (const b of boxes) if (!ends.has(b.id) && pathHitsRect(path, r(b))) issues.push(`arrow ${a.id} crosses box ${b.id}`);
    for (const l of labels) if (l.containerId !== a.id && pathHitsRect(path, r(l))) issues.push(`arrow ${a.id} crosses label ${name(l)}`);
  }
  return issues;
}
