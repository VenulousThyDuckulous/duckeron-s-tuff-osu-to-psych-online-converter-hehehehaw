import { readOsz } from './osz.js';
import { convertToPsych } from './converter.js';
import { buildModZip } from './zipBuilder.js';
import { uploadToStorage } from './storage.js';

const $ = (id) => document.getElementById(id);

const state = {
  oszFile: null,
  data: null,
  selectedMaps: new Set(),
  modBlob: null,
  modFileName: null,
  shareUrl: null,
};

function setProgress(pct, text) {
  const bar = $('progressBar');
  const t = $('progressText');
  if (bar) bar.style.width = pct + '%';
  if (t) t.textContent = text || '';
}

function showError(msg) {
  const el = $('errors');
  if (!el) return;
  el.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'error';
  d.textContent = msg;
  el.appendChild(d);
}
function clearErrors() { const el = $('errors'); if (el) el.innerHTML = ''; }
function showWarning(msg) {
  const el = $('warnings');
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'warning';
  d.textContent = msg;
  el.appendChild(d);
}
function clearWarnings() { const el = $('warnings'); if (el) el.innerHTML = ''; }

function slugify(s) {
  return String(s || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
}

// storage settings
function loadStorSettings() {
  $('storToken').value = localStorage.getItem('osuconv_token') || '';
  $('storRepo').value = localStorage.getItem('osuconv_repo') || 'VenulousThyDuckulous/raw-file-storgae-cuz-yes-data';
  $('storBranch').value = localStorage.getItem('osuconv_branch') || 'main';
  $('storPrefix').value = localStorage.getItem('osuconv_prefix') || 'storage';
}
function saveStorSettings() {
  localStorage.setItem('osuconv_token', $('storToken').value.trim());
  localStorage.setItem('osuconv_repo', $('storRepo').value.trim());
  localStorage.setItem('osuconv_branch', $('storBranch').value.trim() || 'main');
  localStorage.setItem('osuconv_prefix', $('storPrefix').value.trim() || 'storage');
}

loadStorSettings();
$('saveStorBtn').addEventListener('click', () => { saveStorSettings(); alert('Saved'); });

// dropzone
const dropzone = $('dropzone');
const fileInput = $('fileInput');
$('browseBtn').addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', (e) => { if (e.target === dropzone || e.target.tagName === 'P') fileInput.click(); });
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(f) {
  clearErrors(); clearWarnings();
  setProgress(5, 'Reading archive…');
  state.oszFile = f;
  state.data = null;
  state.modBlob = null;
  $('resultCard').hidden = true;
  try {
    const data = await readOsz(f, window.JSZip);
    state.data = data;
    if (!data.validMaps.length) {
      const reasons = data.maps.map(m => m.parsed.mode !== 3 ? 'non-mania' : (m.parsed.circleSize !== 4 ? 'not 4K' : 'invalid'));
      showError('No valid osu!mania 4K beatmaps found. ' + (data.maps.length ? `Found ${data.maps.length} map(s): ${reasons.join(', ')}` : 'No .osu files.'));
      setProgress(0, 'Failed');
      return;
    }
    if (!data.audioFile) {
      showWarning('No audio file found in archive. ZIP will have no audio; add Inst.ogg manually.');
    } else {
      const ext = (data.audioName.split('.').pop() || '').toLowerCase();
      if (ext !== 'ogg' && ext !== 'oga') {
        showWarning(`Audio is ${ext.toUpperCase()}. Psych Engine expects OGG Vorbis (Inst.ogg). Auto-conversion is not available; convert manually or replace Inst.ogg.`);
      }
    }
    renderInfo(data);
    setProgress(100, 'Archive loaded.');
  } catch (e) {
    showError('Failed to read .osz: ' + e.message);
    setProgress(0, 'Failed');
  }
}

function renderInfo(data) {
  const card = $('infoCard');
  card.hidden = false;
  const first = data.validMaps[0].parsed;
  const info = $('info');
  info.innerHTML = '';
  const rows = [
    ['Title', first.title],
    ['Artist', first.artist],
    ['Mapper', first.creator],
    ['BPM', Math.round(first.bpm0 * 100) / 100],
    ['Audio', data.audioName || 'none'],
    ['Valid maps', data.validMaps.length],
  ];
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    div.className = 'inforow';
    div.innerHTML = `<span class="label">${k}</span><span>${escapeHtml(String(v))}</span>`;
    info.appendChild(div);
  }
  // diff list
  const diffList = $('diffList');
  diffList.innerHTML = '';
  state.selectedMaps.clear();
  data.validMaps.forEach((m, idx) => {
    const id = 'diff_' + idx;
    const wrap = document.createElement('label');
    wrap.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedMaps.add(idx); else state.selectedMaps.delete(idx);
    });
    state.selectedMaps.add(idx);
    wrap.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = `${m.parsed.version} (${m.parsed.difficulty['OverallDifficulty'] ?? '?'})`;
    wrap.appendChild(span);
    diffList.appendChild(wrap);
  });
  $('slugInput').value = slugify(first.title);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

$('convertBtn').addEventListener('click', async () => {
  clearErrors(); clearWarnings();
  if (!state.data) { showError('No archive loaded.'); return; }
  const selected = [...state.selectedMaps];
  if (!selected.length) { showError('Select at least one difficulty.'); return; }
  const slug = slugify($('slugInput').value);
  setProgress(10, 'Converting…');
  try {
    const charts = [];
    for (let i = 0; i < selected.length; i++) {
      const idx = selected[i];
      const m = state.data.validMaps[idx];
      setProgress(10 + Math.round((i / selected.length) * 50), `Converting ${m.parsed.version}…`);
      const { chart, meta } = convertToPsych(m.parsed);
      charts.push({ difficulty: m.parsed.version, chart });
    }
    setProgress(65, 'Building ZIP…');
    const first = state.data.validMaps[selected[0]].parsed;
    const audioExt = state.data.audioName ? (state.data.audioName.split('.').pop() || 'ogg') : null;
    const blob = await buildModZip({
      songSlug: slug,
      title: first.title,
      artist: first.artist,
      charts,
      audioBlob: state.data.audioFile,
      audioExt,
      JSZip: window.JSZip,
    });
    state.modBlob = blob;
    state.modFileName = `${slug}-psych-mod.zip`;
    state.shareUrl = null;
    $('resultCard').hidden = false;
    $('resultSummary').textContent = `Generated ${charts.length} chart(s). ZIP size: ${(blob.size / 1024 / 1024).toFixed(2)} MB.`;
    $('copyShareBtn').hidden = true;
    $('shareBox').hidden = true;
    setProgress(100, 'Done');
    if (state.data.audioFile) {
      const ext = (state.data.audioName.split('.').pop() || '').toLowerCase();
      if (ext !== 'ogg' && ext !== 'oga') {
        showWarning('Audio not OGG. Replace Inst audio with OGG Vorbis before using in Psych Engine.');
      }
    }
  } catch (e) {
    showError('Conversion failed: ' + e.message);
    setProgress(0, 'Failed');
  }
});

$('downloadBtn').addEventListener('click', () => {
  if (!state.modBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(state.modBlob);
  a.download = state.modFileName || 'mod.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$('uploadBtn').addEventListener('click', async () => {
  if (!state.modBlob) { showError('Convert first.'); return; }
  const token = localStorage.getItem('osuconv_token') || '';
  const repo = localStorage.getItem('osuconv_repo') || '';
  const branch = localStorage.getItem('osuconv_branch') || 'main';
  const prefix = localStorage.getItem('osuconv_prefix') || 'storage';
  if (!token || !repo) { showError('Set storage token/repo first.'); return; }
  clearErrors();
  try {
    const file = new File([state.modBlob], state.modFileName || 'mod.zip', { type: 'application/zip' });
    const { manifestUrl } = await uploadToStorage({
      token, repo, branch, prefix, file,
      onProgress: (p, t) => setProgress(p, t),
    });
    const shareUrl = 'https://venulousthyduckulous.github.io/raw-file-storage-for-smth/?manifest=' + encodeURIComponent(manifestUrl);
    state.shareUrl = shareUrl;
    $('shareUrl').value = shareUrl;
    $('shareBox').hidden = false;
    $('copyShareBtn').hidden = false;
    setProgress(100, 'Upload complete.');
  } catch (e) {
    showError('Upload failed: ' + e.message);
    setProgress(0, 'Failed');
  }
});

$('copyShareBtn').addEventListener('click', async () => {
  if (!state.shareUrl) return;
  try { await navigator.clipboard.writeText(state.shareUrl); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = state.shareUrl; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
});

$('openShareBtn').addEventListener('click', () => {
  if (state.shareUrl) window.open(state.shareUrl, '_blank');
});

$('resetBtn').addEventListener('click', () => {
  state.oszFile = null; state.data = null; state.modBlob = null; state.shareUrl = null;
  fileInput.value = '';
  $('infoCard').hidden = true;
  $('resultCard').hidden = true;
  clearErrors(); clearWarnings();
  setProgress(0, '');
});
