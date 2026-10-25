export async function uploadToProxy({ proxyUrl, file, onProgress }) {
  if (onProgress) onProgress(5, 'Uploading to proxy…');
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(proxyUrl, { method: 'POST', body: form });
  if (onProgress) onProgress(90, 'Processing…');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Proxy upload failed (' + res.status + ')');
  }
  const data = await res.json();
  if (onProgress) onProgress(100, 'Done');
  return { manifestUrl: data.manifestUrl, manifest: data.manifest };
}

export async function uploadToStorage({ token, repo, branch, prefix, file, onProgress }) {
  const parseRepo = (s) => {
    const p = s.split('/');
    if (p.length !== 2) throw new Error('Repo must be owner/repo');
    return { owner: p[0], repo: p[1] };
  };
  const { owner, repo: repoName } = parseRepo(repo);
  const chunkSize = 20 * 1024 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'file';
  const id = `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const basePrefix = [prefix || 'storage', id].filter(Boolean).join('/');

  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const uint8ToBase64 = (uint8) => {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < uint8.length; i += chunk) {
      const sub = uint8.subarray(i, Math.min(i + chunk, uint8.length));
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  };

  const putFile = async (path, contentB64, message) => {
    const url = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodePath(path)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ message, content: contentB64, branch }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'Upload failed (' + res.status + ')');
    }
    return res.json();
  };

  // verify repo
  const vres = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!vres.ok) throw new Error('Repo access failed');

  const chunkUrls = [];
  for (let i = 0; i < totalChunks; i++) {
    if (onProgress) onProgress(Math.round((i / totalChunks) * 90), `Uploading chunk ${i + 1}/${totalChunks}…`);
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const blob = file.slice(start, end);
    const buf = await blob.arrayBuffer();
    const b64 = uint8ToBase64(new Uint8Array(buf));
    const chunkPath = `${basePrefix}/chunk_${String(i).padStart(4, '0')}.bin`;
    await putFile(chunkPath, b64, `Upload chunk ${i + 1}/${totalChunks}`);
    chunkUrls.push(`https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${chunkPath}`);
  }

  const manifest = {
    name: file.name,
    size: file.size,
    type: file.type || 'application/zip',
    chunkSize,
    chunkCount: totalChunks,
    chunks: Array.from({ length: totalChunks }, (_, i) => `chunk_${String(i).padStart(4, '0')}.bin`),
    chunkUrls,
    uploadedAt: new Date().toISOString(),
    storageRepo: `${owner}/${repoName}`,
    branch,
    prefix: basePrefix,
  };
  const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2))));
  const manifestPath = `${basePrefix}/manifest.json`;
  await putFile(manifestPath, manifestB64, 'Add manifest');
  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${manifestPath}`;
  if (onProgress) onProgress(100, 'Done');
  return { manifestUrl, manifest };
}
