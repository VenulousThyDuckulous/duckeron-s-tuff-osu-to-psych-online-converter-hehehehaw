import { parseOsuText } from './converter.js';

export async function readOsz(file, JSZip) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.keys(zip.files);
  const osuEntries = entries.filter((n) => n.toLowerCase().endsWith('.osu'));
  const maps = [];
  let audioName = null;
  let audioFile = null;

  for (const name of osuEntries) {
    try {
      const text = await zip.files[name].async('string');
      const parsed = parseOsuText(text);
      // find audio name
      if (!audioName && parsed.audioFilename) audioName = parsed.audioFilename;
      maps.push({ fileName: name, parsed });
    } catch (e) {
      // skip
    }
  }

  // find audio file
  if (audioName) {
    // try exact, then case-insensitive, then basename
    const lower = audioName.toLowerCase();
    let found = entries.find((n) => n === audioName);
    if (!found) found = entries.find((n) => n.toLowerCase() === lower);
    if (!found) {
      const base = audioName.split('/').pop().toLowerCase();
      found = entries.find((n) => n.toLowerCase().endsWith(base));
    }
    if (found) {
      audioFile = await zip.files[found].async('blob');
      audioName = found;
    }
  }

  // validate each map
  const validMaps = maps.filter(({ parsed }) => parsed.mode === 3 && parsed.circleSize === 4);
  return { maps, validMaps, audioName, audioFile, allEntries: entries };
}
