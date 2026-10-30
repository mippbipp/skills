// Legibility of the generated sketch: text fits its boxes, nothing overlaps, arrows and
// their labels keep clear of boxes and of each other.  Run: node --test 'system-atlas/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildScene } from '../assets/sketch.mjs';
import { layoutIssues, measure } from '../assets/layout.mjs';
import { validate } from '../assets/validate.mjs';
import { crowded } from './fixtures/crowded.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets');
const example = await import(pathToFileURL(join(assets, 'data.example.mjs')).href);

test('measure uses Excalifont advance widths', () => {
  assert.equal(measure('iiii', 10).width, 10); // 4 × 0.24 × 10, rounded up
  assert.ok(measure('WWWW', 10).width > measure('iiii', 10).width * 3);
  assert.equal(measure('a\nb', 16).height, 40);
});

test('example data lays out with no legibility problems', () => {
  const { scene, warnings } = buildScene(example, null, null);
  assert.deepEqual(warnings, []);
  assert.deepEqual(layoutIssues(scene.elements), []);
});

test('a crowded system still lays out legibly', () => {
  const data = crowded();
  assert.deepEqual(validate(data), []);
  const { scene, base, warnings } = buildScene(data, null, null);
  assert.deepEqual(layoutIssues(scene.elements), [], `scale ${base.scale}`);
  assert.deepEqual(warnings, []);
});

test('every box is big enough for its label', () => {
  const { scene } = buildScene(crowded(), null, null);
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  for (const t of scene.elements.filter((e) => e.type === 'text' && byId.get(e.containerId)?.type === 'rectangle')) {
    const box = byId.get(t.containerId);
    assert.ok(t.width + 10 <= box.width && t.height + 10 <= box.height, `${box.id}: ${t.width}×${t.height} in ${box.width}×${box.height}`);
  }
});

test('opposite-direction arrows bow apart instead of stacking their labels', () => {
  const { scene } = buildScene(example, null, null);
  const get = (id) => scene.elements.find((e) => e.id === id);
  const there = get('atlas-edge-I-M-label'), back = get('atlas-edge-M-I-label');
  const gap = Math.hypot(there.x - back.x, there.y - back.y);
  assert.ok(gap > there.height, `labels ${gap.toFixed(0)}px apart`);
});

test('a small label change keeps the scale, so boxes do not jump', () => {
  const first = buildScene(example, null, null);
  const data = structuredClone({ ...example, NODES: example.NODES.map((n) => ({ ...n })) });
  data.NODES[0].cond = [...data.NODES[0].cond, 'Another question?'];
  const second = buildScene(data, first.scene, first.base);
  assert.equal(second.base.scale, first.base.scale);
  const pos = (s, id) => s.scene.elements.find((e) => e.id === id);
  for (const id of ['atlas-node-I', 'atlas-node-M']) {
    assert.equal(pos(second, id).x, pos(first, id).x);
    assert.equal(pos(second, id).y, pos(first, id).y);
  }
});

test('a scene from before per-atlas scales is re-laid out and its notes move with it', () => {
  const OLD = 60;
  const legacyBase = { nodes: {}, edges: {} }; // old bases had no scale
  const note = { id: 'n1', type: 'text', x: 9 * OLD, y: 9 * OLD, width: 100, height: 20, text: 'hm', originalText: 'hm', isDeleted: false, version: 1 };
  const { scene, base } = buildScene(example, { type: 'excalidraw', elements: [note] }, legacyBase);
  const moved = scene.elements.find((e) => e.id === 'n1');
  const f = base.scale / OLD;
  assert.equal(moved.x + moved.width / 2, (9 * OLD + 50) * f);
  assert.deepEqual(layoutIssues(scene.elements), []);
});
