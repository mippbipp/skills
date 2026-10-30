// The data validator: the example data passes, and each common mistake is caught by name.
// Run: node --test 'system-atlas/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isoWarnings, validate } from '../assets/validate.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets');
const example = await import(pathToFileURL(join(assets, 'data.example.mjs')).href);
const fresh = () => structuredClone({ META: example.META, DECISIONS: example.DECISIONS, GROUPS: example.GROUPS, NODES: example.NODES, FLOWS: example.FLOWS, CH: example.CH });
const node = (d, id) => d.NODES.find((n) => n.id === id);
const expectError = (d, re) => {
  const errs = validate(d);
  assert.ok(errs.some((e) => re.test(e)), `expected ${re} in:\n${errs.join('\n') || '(no errors)'}`);
};

test('example data is valid', () => assert.deepEqual(validate(fresh()), []));

test('hop to a node that does not exist', () => {
  const d = fresh();
  d.FLOWS[0].hops[0][1] = 'X';
  expectError(d, /FLOWS\[0\] \(turn\) hop 1: to "X" is not a node id/);
});

test('chapter flow touching a structure revealed later', () => {
  const d = fresh();
  d.CH[0].flow.push(['I', 'M', 'recall', {}]);
  expectError(d, /CH\[0\] \(you\) flow hop 3: to "M" is not revealed/);
});

test('unknown kind, missing prose, long short label', () => {
  const d = fresh();
  node(d, 'U').kind = 'cylinder';
  delete node(d, 'I').one;
  node(d, 'M').short = 'A VERY LONG LABEL';
  expectError(d, /\(U\): unknown kind "cylinder"/);
  expectError(d, /\(I\): missing one/);
  expectError(d, /\(M\): short .* longer than 14/);
});

test('duplicate code would collide question IDs', () => {
  const d = fresh();
  node(d, 'M').code = 'U';
  expectError(d, /duplicate code "U"/);
});

test('malformed questions', () => {
  const d = fresh();
  node(d, 'U').cond.push({ q: 'half done' }, { q: 'both', r: 'yes', to: 'research' });
  expectError(d, /Q-U3\): an object question needs r .* or to/);
  expectError(d, /Q-U4\): has both r and to/);
});

test('structure never revealed, and last chapter shape', () => {
  const d = fresh();
  d.CH[2].reveal = [];
  d.CH.at(-1).flow = [];
  expectError(d, /NODES \(P\): is never revealed/);
  expectError(d, /last chapter must have reveal: \[\] and flow: null/);
});

test('unknown group and bad bend', () => {
  const d = fresh();
  node(d, 'U').group = 'nowhere';
  d.FLOWS[0].hops[0][4] = 'zz';
  expectError(d, /group "nowhere" is not in GROUPS/);
  expectError(d, /bend "zz" must be "xy" or "yx"/);
});

test('overlapping footprints are an error', () => {
  const d = fresh();
  Object.assign(node(d, 'M'), { gx: node(d, 'I').gx + 1, gy: node(d, 'I').gy + 1 });
  expectError(d, /NODES \(I, M\): footprints overlap/);
});

test('isometric name tags that cover each other are a warning', () => {
  const d = fresh();
  assert.deepEqual(isoWarnings(d), []);
  // Same front corner (gx+w, gy+d) puts both tags in the same place.
  Object.assign(node(d, 'M'), { gx: 20, gy: 20, w: 2, d: 2 });
  Object.assign(node(d, 'P'), { gx: 21, gy: 21, w: 1, d: 1 });
  assert.ok(isoWarnings(d).some((w) => /name tags of M and P overlap/.test(w)), isoWarnings(d).join('\n'));
});
