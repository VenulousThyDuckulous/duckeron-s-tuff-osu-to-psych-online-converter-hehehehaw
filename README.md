# osu!mania 4K → FNF Psych Engine 1.0.4 Converter

Browser-based converter that turns osu!mania 4K `.osz` beatmaps into playable FNF Psych Engine 1.0.4 mods.

## Features
- Drag & drop `.osz` upload, local parsing with JSZip.
- Validates osu!mania Mode 3 and CircleSize 4.
- Beatmap selector for multiple difficulties.
- BPM changes, offbeat notes, holds, chords, streams.
- Lane mapping: 0→left, 1→down, 2→up, 3→right.
- Generates Psych Engine chart JSON and mod ZIP.
- Optional upload to chunked storage site for shareable links.

## Run locally
```
python -m http.server 8080
```
Open http://localhost:8080

## Tests
```
node tests/run.mjs
```

## Deploy
Push to `main`; GitHub Actions deploys to Pages. Enable Pages with source "GitHub Actions".

## Limitations
- Audio must be OGG Vorbis for Psych Engine. If input audio is MP3/WAV, the ZIP includes original audio and a warning; convert to OGG manually.
- Automatic storage upload requires your own GitHub token (not embedded).
- Very large .osz files may hit browser memory limits.
EOF