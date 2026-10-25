export async function buildModZip({ songSlug, title, artist, charts, audioBlob, audioExt, JSZip }) {
  const zip = new JSZip();
  const root = songSlug;
  for (const c of charts) {
    const diffSlug = (c.difficulty || 'normal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'normal';
    const fileName = `${songSlug}-${diffSlug}.json`;
    zip.file(`${root}/data/${songSlug}/${fileName}`, JSON.stringify(c.chart, null, 2));
  }
  if (audioBlob) {
    const ext = (audioExt || 'ogg').toLowerCase();
    const name = ext === 'ogg' ? 'Inst.ogg' : `Inst.${ext}`;
    zip.file(`${root}/songs/${songSlug}/${name}`, audioBlob);
  }
  zip.file(`${root}/pack.json`, JSON.stringify({
    name: title,
    description: `Converted from osu!mania 4K by ${artist || 'unknown'}`,
    version: '1.0.0',
    engine: 'Psych Engine 1.0.4',
  }, null, 2));
  zip.file(`${root}/README.txt`, `Psych Engine 1.0.4 mod generated from osu!mania 4K.

Song: ${title}
Artist: ${artist || 'Unknown'}

Installation:
1. Extract this folder into your Psych Engine mods directory.
2. Select the mod from the Mods menu.
3. Ensure audio is OGG Vorbis named Inst.ogg.

Notes:
- Converted charts use 4 lanes mapped to left/down/up/right.
- needsVoices is set to false (instrumental only).
- If the original audio was not OGG, convert it to OGG Vorbis and replace Inst.ogg.
`);
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob;
}
