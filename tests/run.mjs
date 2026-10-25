import { parseOsuText, validateMania4K, convertToPsych } from '../src/converter.js';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS:', name); }
  catch (e) { console.error('FAIL:', name, '\n', e.message); process.exitCode = 1; }
}

const basicOsu = `
osu file format v14

[General]
Mode: 3
AudioFilename: song.mp3

[Metadata]
Title: Test Song
Artist: Tester
Creator: Mapper
Version: Hard

[Difficulty]
CircleSize: 4
OverallDifficulty: 8

[TimingPoints]
0,500,4,1,0,100,1,0
2000,250,4,1,0,100,1,0

[HitObjects]
64,192,100,1,0,0:0:0:0:
192,192,200,128,0,500:0:0:0:
320,192,300,1,0,0:0:0:0:
448,192,400,1,0,0:0:0:0:
`.trim();

test('parse basic', () => {
  const p = parseOsuText(basicOsu);
  assert.equal(p.mode, 3);
  assert.equal(p.circleSize, 4);
  assert.equal(p.hitObjects.length, 4);
  assert.equal(p.timingPoints.length, 2);
});

test('validate ok', () => {
  const p = parseOsuText(basicOsu);
  assert.deepEqual(validateMania4K(p), []);
});

test('convert produces sections and notes', () => {
  const p = parseOsuText(basicOsu);
  const { chart, meta } = convertToPsych(p);
  assert.equal(chart.song, 'Test Song');
  assert.ok(chart.notes.length > 0);
  const totalNotes = chart.notes.reduce((a, s) => a + s.sectionNotes.length, 0);
  assert.equal(totalNotes, 4);
  // hold sustain
  const hold = chart.notes.flatMap(s => s.sectionNotes).find(n => n[2] > 0);
  assert.ok(hold, 'hold note present');
  assert.equal(hold[2], 300);
});

test('invalid mode rejected', () => {
  const text = basicOsu.replace('Mode: 3', 'Mode: 0');
  const p = parseOsuText(text);
  assert.ok(validateMania4K(p).length > 0);
});

test('non-4k rejected', () => {
  const text = basicOsu.replace('CircleSize: 4', 'CircleSize: 7');
  const p = parseOsuText(text);
  assert.ok(validateMania4K(p).length > 0);
});

test('lane mapping', () => {
  const p = parseOsuText(basicOsu);
  const { chart } = convertToPsych(p);
  const lanes = chart.notes.flatMap(s => s.sectionNotes).map(n => n[1]);
  assert.ok(lanes.includes(0) && lanes.includes(1) && lanes.includes(2) && lanes.includes(3));
});

test('bpm change', () => {
  const p = parseOsuText(basicOsu);
  const { chart } = convertToPsych(p);
  const changes = chart.notes.filter(s => s.changeBPM);
  assert.ok(changes.length >= 2);
});

test('share url encoding', () => {
  const m = 'https://raw.githubusercontent.com/a/b/main/storage/x/manifest.json';
  const u = 'https://venulousthyduckulous.github.io/raw-file-storage-for-smth/?manifest=' + encodeURIComponent(m);
  assert.ok(u.includes('%3A%2F%2F'));
});

console.log(`\n${passed} tests passed`);