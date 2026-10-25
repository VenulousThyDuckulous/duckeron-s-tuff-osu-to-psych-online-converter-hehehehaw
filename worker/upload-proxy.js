// Cloudflare Worker: uploads a file to a GitHub Release and returns a direct download URL.
// No 100MB limit (GitHub Releases support up to 2GB per asset).
// Set secrets/vars in Cloudflare:
//   GITHUB_TOKEN  (secret)  - PAT with Contents: Read/Write on STORAGE_REPO
//   STORAGE_REPO  (var)     - owner/repo (should be PUBLIC for direct links)
//   ALLOWED_ORIGIN (var)    - * or your site origin

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsOrigin = allowed === '*' ? '*' : (origin === allowed ? origin : allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(corsOrigin) });
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
    if (!token || !repo) {
      return json({ error: 'Worker not configured (GITHUB_TOKEN/STORAGE_REPO)' }, 500, corsOrigin);
    }
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      return json({ error: 'STORAGE_REPO must be owner/repo' }, 500, corsOrigin);
    }

    try {
      const releaseTag = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Create a release
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/releases`, {
        method: 'POST',
        headers: {
          'User-Agent': 'osu-storage-proxy',
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          tag_name: releaseTag,
          name: file.name || 'upload',
          body: 'Uploaded via osu converter',
          draft: false,
          prerelease: false,
        }),
      });
      if (!relRes.ok) {
        const text = await relRes.text().catch(() => '');
        throw new Error('Release create failed (' + relRes.status + '): ' + text.slice(0, 300));
      }
      const release = await relRes.json();

      // Upload asset (binary, no base64)
      const assetName = (file.name || 'upload.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadUrl = `https://uploads.github.com/repos/${owner}/${repoName}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
      const assetRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'osu-storage-proxy',
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': String(file.size),
        },
        body: file,
      });
      if (!assetRes.ok) {
        const text = await assetRes.text().catch(() => '');
        throw new Error('Asset upload failed (' + assetRes.status + '): ' + text.slice(0, 300));
      }
      const asset = await assetRes.json();
      const directUrl = asset.browser_download_url;
      if (!directUrl) throw new Error('No download URL returned');

      return json({ directUrl }, 200, corsOrigin);
    } catch (e) {
      return json({ error: e.message || 'Upload failed', tokenPresent: !!env.GITHUB_TOKEN }, 500, corsOrigin);
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