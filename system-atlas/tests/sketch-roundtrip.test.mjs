// Round trip of the Excalidraw sketch against the example data: simulated user edits,
// fold proposals, rebuild merges, accept/dismiss.  Run: node --test system-atlas/tests/
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-sketch-'));
  const home = join(root, 'atlas');
  mkdirSync(home);
  for (const f of ['template.html', 'build.mjs', 'validate.mjs', 'sketch.mjs', 'layout.mjs', 'fold.mjs']) cpSync(join(assets, f), join(home, f));
  cpSync(join(assets, 'data.example.mjs'), join(home, 'data.mjs'));
  const run = (...a) => execFileSync('node', a, { cwd: home, encoding: 'utf8' });
  const scenePath = join(root, 'atlas.excalidraw');
  const load = () => JSON.parse(readFileSync(scenePath, 'utf8'));
  const save = (s) => writeFileSync(scenePath, JSON.stringify(s));
  run('build.mjs');
  return { root, home, run, load, save };
}

const user = (id, type, extra) => ({ id, type, x: 0, y: 0, width: 100, height: 60, angle: 0, strokeColor: '#000', backgroundColor: 'transparent', strokeStyle: 'solid', isDeleted: false, boundElements: [], version: 1, ...extra });

test('fresh build has nothing to fold', () => {
  const { root, run } = setup();
  try {
    assert.equal(run('fold.mjs').trim(), 'no sketch edits to fold');
    run('build.mjs');
    assert.equal(run('fold.mjs').trim(), 'no sketch edits to fold', 'rebuild is idempotent');
  } finally { rmSync(root, { recursive: true }); }
});

test('edits become proposals, survive rebuilds, and accept/dismiss settle them', () => {
  const { root, home, run, load, save } = setup();
  try {
    let s = load();
    const get = (id) => s.elements.find((e) => e.id === id);
    get('atlas-node-M').x += 120;
    // Excalidraw keeps what was typed in originalText and the wrapped version in text.
    Object.assign(get('atlas-node-I-label'), { text: 'I · Root\nbrain', originalText: 'I · Root brain' });
    s.elements = s.elements.filter((e) => !e.id.startsWith('atlas-edge-M-I'));
    get('atlas-node-U').strokeStyle = 'dashed';
    const I = get('atlas-node-I'), M = get('atlas-node-M');
    s.elements.push(
      user('box1', 'rectangle', { x: 900, y: 420, boundElements: [{ type: 'text', id: 'box1t' }] }),
      user('box1t', 'text', { text: 'Scheduler', containerId: 'box1' }),
      user('arr1', 'arrow', { x: 950, y: 420, points: [[0, 0], [I.x + 10 - 950, I.y + I.height - 10 - 420]], startBinding: { elementId: 'box1' }, endBinding: { elementId: I.id } }),
      user('note1', 'text', { x: M.x + 20, y: M.y + M.height + 20, text: 'what about retention?' }),
      user('note2', 'text', { x: -500, y: -500, text: 'Q-U1: same origin as the API' }),
      user('sticky', 'rectangle', { x: -800, y: 900, backgroundColor: '#ffec99', boundElements: [{ type: 'text', id: 'stickyt' }] }),
      user('stickyt', 'text', { text: 'try sqlite first', containerId: 'sticky' }),
    );
    const movedX = M.x;
    save(s);

    const out = run('fold.mjs');
    for (const want of ['M: move', 'rename "Root agent" → "Root brain"', 'U: mark as ghost', 'M → I: arrow deleted', 'new structure new-1 "Scheduler"', 'new flow hop new-1 → I', 'question on M: "what about retention?"', 'Q-U1: resolve with "same origin as the API" (question: Where does the page live?)', 'unattached note: "try sqlite first"'])
      assert.ok(out.includes(want), `missing "${want}" in:\n${out}`);

    run('build.mjs');
    s = load();
    assert.equal(get('atlas-node-M').x, movedX, 'pending move kept');
    assert.equal(get('atlas-node-I-label').originalText, 'I · Root brain', 'pending rename kept');
    assert.ok(!get('atlas-edge-M-I'), 'pending delete kept');
    assert.ok(get('atlas-node-I').boundElements.some((b) => b.id === 'arr1'), 'user arrow bound on generated box');
    assert.equal(run('fold.mjs'), out, 'proposal stable across rebuild');

    const lines = out.trim().split('\n');
    const renameN = lines.find((l) => l.includes('rename')).split('.')[0];
    run('fold.mjs', '--accept', lines.map((l) => l.split('.')[0]).filter((n) => n !== renameN).join(','), '--dismiss', renameN);
    run('build.mjs');
    s = load();
    assert.equal(get('atlas-node-I-label').text, 'I · Root agent', 'dismissed rename reverted');
    assert.ok(!get('box1') && !get('arr1'), 'accepted shapes removed');
    assert.equal(get('note1').opacity, 30, 'folded note dimmed');
    const after = run('fold.mjs');
    assert.ok(after.includes('M: move') && !after.includes('rename') && !after.includes('retention'), after);

    // Data now takes the move: the proposal goes away and the box stays where the user put it.
    const dataPath = join(home, 'data.mjs');
    writeFileSync(dataPath, readFileSync(dataPath, 'utf8').replace("short: 'MEMORY', group: 'mem', gx: 6.5", "short: 'MEMORY', group: 'mem', gx: 8.5"));
    run('build.mjs');
    s = load();
    const { scale } = JSON.parse(readFileSync(join(home, 'sketch-base.json'), 'utf8'));
    const m = get('atlas-node-M');
    assert.equal(m.x + m.width / 2, (8.5 + 3 / 2) * scale, 'box centred on its new footprint');
    assert.ok(!run('fold.mjs').includes('M: move'));
  } finally { rmSync(root, { recursive: true }); }
});

test('fold refuses stale proposal numbers', () => {
  const { root, run, load, save } = setup();
  try {
    const s = load();
    s.elements.push(user('n', 'text', { text: 'hello' }));
    save(s);
    run('fold.mjs');
    s.elements.push(user('n2', 'text', { text: 'again' }));
    save(s);
    assert.throws(() => run('fold.mjs', '--accept', 'all'), /sketch changed/);
  } finally { rmSync(root, { recursive: true }); }
});

test('question IDs in notes are case-insensitive', () => {
  const { root, run, load, save } = setup();
  try {
    const s = load();
    s.elements.push(
      user('a', 'text', { x: -500, y: -500, text: 'q-u1: lower case' }),
      user('b', 'text', { x: -500, y: -400, text: 'Q-u1 - mixed case' }),
    );
    save(s);
    const out = run('fold.mjs');
    for (const answer of ['lower case', 'mixed case'])
      assert.ok(out.includes(`Q-U1: resolve with "${answer}" (question: Where does the page live?)`), out);
    assert.ok(!out.includes('question on'), 'neither note becomes a new question');
  } finally { rmSync(root, { recursive: true }); }
});
