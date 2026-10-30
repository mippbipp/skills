// Checks data.mjs before a build. Returns a list of problems, each naming where it is;
// build.mjs refuses to write anything while the list is non-empty.
export const KINDS = ['box', 'tall', 'store', 'cards', 'slab', 'screen', 'gate', 'job'];
const REQUIRED_NODE = ['id', 'code', 'name', 'short', 'group', 'one', 'what', 'how'];
const NUMERIC_NODE = ['gx', 'gy', 'w', 'd', 'h'];

export function validate({ META, DECISIONS, GROUPS, NODES, FLOWS, CH }) {
  const errs = [];
  const err = (where, msg) => errs.push(`${where}: ${msg}`);
  const isList = (v, where) => Array.isArray(v) || (err(where, 'must be an array'), false);

  if (!META || typeof META.title !== 'string' || !META.title) err('META.title', 'missing');
  if (typeof META?.onePara !== 'string' || !META.onePara.trim()) err('META.onePara', 'missing (the one-paragraph summary at the top of SYSTEM.md)');
  if (META?.costModel !== undefined && !Array.isArray(META.costModel)) err('META.costModel', 'must be an array of lines');
  if (!isList(GROUPS, 'GROUPS') || !isList(NODES, 'NODES') || !isList(FLOWS, 'FLOWS') || !isList(CH, 'CH') || !isList(DECISIONS, 'DECISIONS')) return errs;

  const groups = new Set();
  GROUPS.forEach((g, i) => {
    if (!g?.id) return err(`GROUPS[${i}]`, 'missing id');
    if (groups.has(g.id)) err(`GROUPS[${i}]`, `duplicate id "${g.id}"`);
    groups.add(g.id);
  });

  const ids = new Set(), codes = new Set();
  NODES.forEach((n, i) => {
    const where = `NODES[${i}]${n?.id ? ` (${n.id})` : ''}`;
    for (const f of REQUIRED_NODE) if (typeof n?.[f] !== 'string' || !n[f].trim()) err(where, `missing ${f}`);
    for (const f of NUMERIC_NODE) if (!Number.isFinite(n?.[f])) err(where, `${f} must be a number`);
    if (n?.w <= 0 || n?.d <= 0) err(where, 'w and d must be positive');
    if (n?.kind !== undefined && !KINDS.includes(n.kind)) err(where, `unknown kind "${n.kind}" (one of ${KINDS.join(', ')})`);
    if (n?.group && !groups.has(n.group)) err(where, `group "${n.group}" is not in GROUPS`);
    if (typeof n?.short === 'string' && n.short.length > 14) err(where, `short "${n.short}" is longer than 14 characters`);
    if (n?.id) {
      if (ids.has(n.id)) err(where, `duplicate id "${n.id}"`);
      ids.add(n.id);
    }
    if (n?.code) {
      if (codes.has(n.code)) err(where, `duplicate code "${n.code}" (question IDs would collide)`);
      codes.add(n.code);
    }
    if (n?.steps !== undefined && !(Array.isArray(n.steps) && n.steps.every((s) => Array.isArray(s) && s.length === 2 && s.every((x) => typeof x === 'string'))))
      err(where, 'steps must be [[name, desc], …]');
    (n?.cond ?? []).forEach((c, j) => {
      const q = `${where} cond[${j}] (Q-${n.code}${j + 1})`;
      if (typeof c === 'string') return c.trim() || err(q, 'empty question');
      if (typeof c?.q !== 'string' || !c.q.trim()) return err(q, 'missing q');
      if (c.r === undefined && c.to === undefined) err(q, 'an object question needs r (resolved) or to (routed); use a plain string while open');
      if (c.r !== undefined && c.to !== undefined) err(q, 'has both r and to; pick one');
    });
  });

  const hop = (h, where, allowed) => {
    if (!Array.isArray(h) || h.length < 3) return err(where, 'hop must be [from, to, label, payload?, bend?]');
    const [from, to, label, , bend] = h;
    for (const [end, v] of [['from', from], ['to', to]]) {
      if (!ids.has(v)) err(where, `${end} "${v}" is not a node id`);
      else if (allowed && !allowed.has(v)) err(where, `${end} "${v}" is not revealed by this chapter or an earlier one`);
    }
    if (typeof label !== 'string') err(where, 'label must be a string');
    if (bend !== undefined && bend !== 'xy' && bend !== 'yx') err(where, `bend "${bend}" must be "xy" or "yx"`);
  };

  const flowIds = new Set();
  FLOWS.forEach((f, i) => {
    const where = `FLOWS[${i}]${f?.id ? ` (${f.id})` : ''}`;
    if (!f?.id || !f?.name) err(where, 'missing id or name');
    if (f?.id === 'both') err(where, 'id "both" is reserved for the "All flows" picker');
    if (f?.id) {
      if (flowIds.has(f.id)) err(where, `duplicate id "${f.id}"`);
      flowIds.add(f.id);
    }
    if (!Array.isArray(f?.hops) || !f.hops.length) return err(where, 'hops must be a non-empty array');
    f.hops.forEach((h, j) => hop(h, `${where} hop ${j + 1}`));
  });

  // Chapters reveal cumulatively; each chapter's flow may only touch what is revealed so far.
  const revealed = new Set(), revealedBy = new Map();
  CH.forEach((c, i) => {
    const where = `CH[${i}]${c?.id ? ` (${c.id})` : ''}`;
    if (!c?.title) err(where, 'missing title');
    if (!Array.isArray(c?.reveal)) return err(where, 'reveal must be an array');
    for (const id of c.reveal) {
      if (!ids.has(id)) err(where, `reveals "${id}", which is not a node id`);
      else if (revealedBy.has(id)) err(where, `reveals "${id}" again (already revealed by ${revealedBy.get(id)})`);
      else revealedBy.set(id, where);
      revealed.add(id);
    }
    if (c.reveal.length > 3) err(where, `reveals ${c.reveal.length} structures; keep it to 3 or fewer`);
    if (c.flow === null) return;
    if (!Array.isArray(c.flow) || !c.flow.length) return err(where, 'flow must be a non-empty array of hops, or null on the last chapter');
    c.flow.forEach((h, j) => hop(h, `${where} flow hop ${j + 1}`, revealed));
  });
  if (CH.length) {
    const last = CH[CH.length - 1];
    if (last?.flow !== null || last?.reveal?.length) err(`CH[${CH.length - 1}]`, 'the last chapter must have reveal: [] and flow: null (the whole system)');
    CH.slice(0, -1).forEach((c, i) => c?.flow === null && err(`CH[${i}]`, 'only the last chapter may have flow: null'));
  } else err('CH', 'needs at least one chapter');
  for (const id of ids) if (!revealed.has(id)) err(`NODES (${id})`, 'is never revealed by a chapter');

  DECISIONS.forEach((d, i) => {
    if (!d?.axis || !d?.decision) err(`DECISIONS[${i}]`, 'missing axis or decision');
  });

  // Footprints on top of each other draw one structure inside another on the map.
  const placed = NODES.filter((n) => [n?.gx, n?.gy, n?.w, n?.d].every(Number.isFinite));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.gx < b.gx + b.w && b.gx < a.gx + a.w && a.gy < b.gy + b.d && b.gy < a.gy + a.d) err(`NODES (${a.id}, ${b.id})`, 'footprints overlap; move one of them (gx/gy)');
  }
  return errs;
}

// Readability problems on the isometric map that are not errors: name tags that cover each
// other. Mirrors template.html (tile 72×36, tag under the front corner, 6.6px per character).
export function isoWarnings({ NODES }) {
  const tag = (n) => {
    const x = (n.gx + n.w - (n.gy + n.d)) * 36, y = (n.gx + n.w + n.gy + n.d) * 18 + 9;
    const w = String(n.short || n.name).length * 6.6 + 10;
    return { x: x - w / 2, y, w, h: 14 };
  };
  const tags = NODES.map((n) => [n, tag(n)]);
  const out = [];
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    const [a, ra] = tags[i], [b, rb] = tags[j];
    if (ra.x < rb.x + rb.w + 4 && rb.x < ra.x + ra.w + 4 && ra.y < rb.y + rb.h + 2 && rb.y < ra.y + ra.h + 2)
      out.push(`isometric map: name tags of ${a.id} and ${b.id} overlap; move one of them (gx/gy) or shorten short`);
  }
  return out;
}
