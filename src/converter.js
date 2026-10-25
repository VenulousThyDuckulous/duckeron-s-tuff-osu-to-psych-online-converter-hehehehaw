export const LANE_MAP = [0, 1, 2, 3]; // osu mania col -> FNF lane

export function parseOsuText(text) {
  const lines = text.split(/\r?\n/);
  const sections = {};
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1);
      sections[current] = sections[current] || [];
      continue;
    }
    if (!current) continue;
    sections[current].push(line);
  }

  const get = (section, key) => {
    const arr = sections[section] || [];
    for (const l of arr) {
      const idx = l.indexOf(':');
      if (idx === -1) continue;
      const k = l.slice(0, idx).trim();
      if (k === key) return l.slice(idx + 1).trim();
    }
    return null;
  };

  const general = {};
  for (const l of sections['General'] || []) {
    const idx = l.indexOf(':');
    if (idx !== -1) general[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
  }
  const metadata = {};
  for (const l of sections['Metadata'] || []) {
    const idx = l.indexOf(':');
    if (idx !== -1) metadata[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
  }
  const difficulty = {};
  for (const l of sections['Difficulty'] || []) {
    const idx = l.indexOf(':');
    if (idx !== -1) difficulty[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
  }

  const mode = Number(general['Mode'] || 0);
  const circleSize = Number(difficulty['CircleSize'] || 0);

  // timing points
  const timingPoints = (sections['TimingPoints'] || []).map((l) => {
    const p = l.split(',');
    return {
      time: Number(p[0]),
      beatLength: Number(p[1]),
      meter: Number(p[2] || 4),
      sampleSet: Number(p[3] || 1),
      sampleIndex: Number(p[4] || 1),
      volume: Number(p[5] || 100),
      uninherited: p.length > 6 ? Number(p[6]) === 1 : true,
      effects: p.length > 7 ? Number(p[7]) : 0,
    };
  }).filter((tp) => !Number.isNaN(tp.time) && !Number.isNaN(tp.beatLength));

  // hit objects
  const hitObjects = [];
  for (const l of sections['HitObjects'] || []) {
    const p = l.split(',');
    if (p.length < 5) continue;
    const x = Number(p[0]);
    const time = Number(p[2]);
    const type = Number(p[3]);
    const col = Math.min(3, Math.max(0, Math.floor(x / 128)));
    if (type & 128) {
      // hold: endTime in 5th field (after hitSound) or 6th? format: x,y,time,type,hitSound,endTime
      const endField = p[5] || '';
      const endTime = Number(String(endField).split(':')[0]);
      hitObjects.push({ time, column: col, isHold: true, endTime: Number.isNaN(endTime) ? time : endTime });
    } else {
      hitObjects.push({ time, column: col, isHold: false, endTime: time });
    }
  }

  return {
    general,
    metadata,
    difficulty,
    mode,
    circleSize,
    timingPoints,
    hitObjects,
    audioFilename: general['AudioFilename'] || '',
    title: metadata['Title'] || 'Unknown',
    artist: metadata['Artist'] || 'Unknown',
    creator: metadata['Creator'] || 'Unknown',
    version: metadata['Version'] || 'Unknown',
    bpm0: timingPoints.length ? (60000 / timingPoints.find(tp => tp.uninherited)?.beatLength || 1) : 0,
  };
}

export function validateMania4K(parsed) {
  const errors = [];
  if (parsed.mode !== 3) errors.push('Not osu!mania (Mode must be 3).');
  if (parsed.circleSize !== 4) errors.push('Not 4K (CircleSize must be 4).');
  if (!parsed.timingPoints.length) errors.push('No timing points found.');
  if (!parsed.hitObjects.length) errors.push('No hit objects found.');
  return errors;
}

export function getBPMAt(timingPoints, time) {
  // find active uninherited timing point
  let active = null;
  for (const tp of timingPoints) {
    if (!tp.uninherited) continue;
    if (tp.time <= time) active = tp;
    else break;
  }
  if (!active && timingPoints.length) {
    // fallback first uninherited
    active = timingPoints.find(tp => tp.uninherited) || timingPoints[0];
  }
  if (!active) return 120;
  return 60000 / active.beatLength;
}

export function convertToPsych(parsed, opts = {}) {
  const errors = validateMania4K(parsed);
  if (errors.length) throw new Error(errors.join(' '));

  const title = parsed.title;
  const bpm0 = getBPMAt(parsed.timingPoints, 0) || 120;
  const uninherited = parsed.timingPoints.filter(tp => tp.uninherited).slice().sort((a, b) => a.time - b.time);

  // build sections by 4-beat measures, cutting at BPM changes
  const songLength = parsed.hitObjects.length
    ? Math.max(...parsed.hitObjects.map(h => h.endTime)) + 2000
    : 60000;
  const sections = [];
  let t = 0;
  // ensure at least one section
  while (t < songLength) {
    // active timing point
    let tp = null;
    for (const x of uninherited) {
      if (x.time <= t) tp = x;
      else break;
    }
    if (!tp) tp = uninherited[0] || parsed.timingPoints[0];
    const bpm = 60000 / tp.beatLength;
    const msPerBeat = 60000 / bpm;
    const sectionBeats = 4;
    const sectionDur = sectionBeats * msPerBeat;
    // next bpm change
    const nextChange = uninherited.find(x => x.time > t);
    const nextChangeTime = nextChange ? nextChange.time : Infinity;
    let end = Math.min(t + sectionDur, nextChangeTime, songLength);
    if (end <= t) end = t + msPerBeat;
    sections.push({ start: t, end, bpm, changeBPM: sections.length === 0 || bpm !== sections[sections.length - 1].bpm, notes: [] });
    t = end;
  }
  if (sections.length === 0) sections.push({ start: 0, end: songLength, bpm: bpm0, changeBPM: true, notes: [] });

  // assign notes
  for (const h of parsed.hitObjects) {
    const lane = LANE_MAP[h.column] ?? h.column;
    const sustain = h.isHold ? Math.max(0, h.endTime - h.time) : 0;
    const note = { time: Math.round(h.time), lane, sustain };
    // find section
    let sec = sections.find(s => h.time >= s.start && h.time < s.end);
    if (!sec) sec = sections[sections.length - 1];
    sec.notes.push(note);
  }

  // build psych notes
  const psychSections = sections.map((s, idx) => ({
    sectionNotes: s.notes
      .sort((a, b) => a.time - b.time)
      .map(n => [n.time, n.lane, n.sustain]),
    lengthInSteps: 16,
    bpm: Math.round(s.bpm * 100) / 100,
    changeBPM: idx === 0 ? true : s.changeBPM,
    mustHitSection: true,
  }));

  // remove trailing empty sections? keep if changeBPM
  const filtered = psychSections.filter((s, idx) => s.sectionNotes.length > 0 || s.changeBPM || idx === 0);
  const finalSections = filtered.length ? filtered : [psychSections[0]];

  const chart = {
    song: title,
    bpm: Math.round(bpm0 * 100) / 100,
    needsVoices: false,
    speed: 1.0,
    player1: 'bf',
    player2: 'dad',
    player3: 'gf',
    events: [],
    notes: finalSections,
    sections: 0,
  };

  return {
    chart,
    meta: {
      title,
      artist: parsed.artist,
      creator: parsed.creator,
      version: parsed.version,
      bpm: chart.bpm,
      durationMs: songLength,
    },
  };
}