# Upload proxy worker

Cloudflare Worker that holds your GitHub token and performs chunked uploads to your storage repo.

## Setup
1. Create a Cloudflare Worker, paste `upload-proxy.js`.
2. Add variables/secrets:
   - `GITHUB_TOKEN` (secret): PAT with Contents Read/Write on your storage repo.
   - `STORAGE_REPO`: `owner/repo`
   - `STORAGE_BRANCH`: `main`
   - `STORAGE_PREFIX`: `storage`
   - `ALLOWED_ORIGIN`: your site origin or `*`
3. Deploy.
4. In the converter site, paste the Worker URL into "Upload proxy URL".

Notes: Free tier request body limit ~100MB. For larger files, use manual publishing.