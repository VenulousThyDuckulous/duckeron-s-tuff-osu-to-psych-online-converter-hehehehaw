// Cloudflare Worker: proxies file uploads to a GitHub storage repo.
// Set secrets/vars in Cloudflare:
//   GITHUB_TOKEN  (secret)  - PAT with Contents: Read/Write on STORAGE_REPO
//   STORAGE_REPO  (var)     - owner/repo
//   STORAGE_BRANCH (var)    - main
//   STORAGE_PREFIX (var)    - storage
//   ALLOWED_ORIGIN (var)    - * or your site origin

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsOrigin = allowed === '*' ? '*' : (origin === allowed ? origin : allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(corsOrigin),
      });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsOrigin);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return json({ error: 'Expected multipart/form-data' }, 400, corsOrigin);
    }
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: 'Missing file field' }, 400, corsOrigin);
    }

    const token = env.GITHUB_TOKEN;
    const repo = env.STORAGE_REPO;
    const branch = env.STORAGE_BRANCH || 'main';
    const prefix = env.STORAGE_PREFIX || 'storage';
    if (!token || !repo) {
      return json({ error: 'Worker not configured (GITHUB_TOKEN/STORAGE_REPO)' }, 500, corsOrigin);
    }

    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      return json({ error: 'STORAGE_REPO must be owner/repo' }, 500, corsOrigin);
    }

    const chunkSize = 20 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'file';
    const id = `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const basePrefix = [prefix, id].filter(Boolean).join('/');

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
          'User-Agent': 'osu-storage-proxy',
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ message, content: contentB64, branch }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = 'Upload failed (' + res.status + ')';
        try { const e = JSON.parse(text); if (e.message) msg = e.message; } catch {}
        throw new Error(msg + ' | body: ' + text.slice(0, 300));
      }
      return res.json();
    };

    const chunkUrls = [];
    try {
      for (let i = 0; i < totalChunks; i++) {
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
        type: file.type || 'application/octet-stream',
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

      return json({ manifestUrl, manifest }, 200, corsOrigin);
    } catch (e) {
      return json({ error: e.message || 'Upload failed', tokenPresent: !!env.GITHUB_TOKEN, tokenPrefix: env.GITHUB_TOKEN ? env.GITHUB_TOKEN.slice(0, 4) : null }, 500, corsOrigin);
    }
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin || '*') },
  });
}