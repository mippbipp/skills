// A crowded system: a 4×3 grid of boxes one grid unit apart with long names, every
// neighbour connected both ways, plus diagonals and long hops across the grid.
export function crowded() {
  const names = ['Ingest gateway', 'Normalizer', 'Provider adapters', 'Rate limiter', 'Event store', 'Planner service', 'Device API route', 'Notification fan-out', 'Audit log', 'Search index', 'Scheduler', 'Admin console'];
  const NODES = names.map((name, i) => ({
    id: String.fromCharCode(65 + i), code: String.fromCharCode(65 + i), name, short: name.slice(0, 14).toUpperCase(), group: 'g',
    gx: (i % 4) * 3, gy: Math.floor(i / 4) * 3, w: 2, d: 2, h: 30, kind: 'box', one: 'x', what: 'x', how: 'x', cond: i % 3 ? ['Open question?'] : [],
  }));
  const hops = [];
  for (let i = 0; i < 12; i++) {
    const right = i % 4 < 3 ? i + 1 : null, down = i + 4 < 12 ? i + 4 : null;
    for (const j of [right, down]) if (j !== null) {
      hops.push([NODES[i].id, NODES[j].id, `request ${i}-${j}`, {}], [NODES[j].id, NODES[i].id, `reply ${j}-${i}`, {}]);
    }
  }
  hops.push(['A', 'F', 'diagonal hop', {}], ['A', 'L', 'long hop across', {}], ['D', 'I', 'other diagonal', {}]);
  return {
    META: { title: 'Crowded', onePara: 'A crowded grid for layout tests.' }, DECISIONS: [], GROUPS: [{ id: 'g', title: 'All' }], NODES,
    FLOWS: [{ id: 'f', name: 'All', hops }],
    CH: [...[0, 3, 6, 9].map((k) => ({ id: `c${k}`, title: 'x', reveal: NODES.slice(k, k + 3).map((n) => n.id), flow: [[NODES[k].id, NODES[k + 1].id, 'x', {}]] })), { id: 'all', title: 'All', reveal: [], flow: null }],
  };
}

// Loadable as a data.mjs, for checking the layout in the editor.
export const { META, DECISIONS, GROUPS, NODES, FLOWS, CH } = crowded();
export const HOW_HTML = '';
