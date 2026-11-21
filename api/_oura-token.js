// Oura refresh-token storage for Vercel: deterministic, no AI.
// Oura's refresh tokens are SINGLE-USE (Oura auth docs: "The refresh
// token is single-use, meaning it is invalidated after being used") —
// every refresh returns a new one, so the sync must save the new token
// somewhere it can read next time, or the second sync fails.
// The repo is PUBLIC, so the token is never stored in plain text: it is
// AES-256-GCM encrypted with a key derived from SESSION_SECRET (already
// in Vercel, never in GitHub or chat) and stored as ciphertext in
// api/oura-refresh.json. That file is not a function and is not served
// by Vercel as a static asset. The env var OURA_REFRESH_TOKEN is only a
// fallback seed for the first run.
// This file starts with _ so Vercel does NOT count it as a function
// (same as _auth.js) — the 12-function Hobby limit is unaffected.
const crypto = require('node:crypto');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';
const PATH = 'api/oura-refresh.json';

function derivedKey() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET not configured in Vercel yet');
  return crypto.createHash('sha256').update('oura-refresh:' + s).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', derivedKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', derivedKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

async function githubGetJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-oura-token'};
  const r = await fetch(api, {headers, signal: AbortSignal.timeout(9000)});
  if (!r.ok) return {data: null, sha: undefined};
  const j = await r.json();
  return {data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha};
}
async function githubPutJson(path, data, message, sha) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-oura-token'};
  const put = await fetch(api, {
    method: 'PUT', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({message, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), ...(sha ? {sha} : {})}),
    signal: AbortSignal.timeout(9000),
  });
  if (!put.ok) throw new Error('GitHub update failed: ' + put.status);
}

// Read the current refresh token: encrypted file first, env var fallback.
async function loadRefreshToken() {
  try {
    const {data} = await githubGetJson(PATH);
    if (data && data.token) return decrypt(data.token);
  } catch (e) { console.error('Oura token file read failed, using env fallback:', e.message); }
  return process.env.OURA_REFRESH_TOKEN || null;
}
// Save a (rotated) refresh token, encrypted, for the next sync.
async function saveRefreshToken(token) {
  const {sha} = await githubGetJson(PATH);
  await githubPutJson(PATH, {token: encrypt(token), updatedAt: new Date().toISOString()}, 'Update Oura refresh token (encrypted)', sha);
}

module.exports = {loadRefreshToken, saveRefreshToken};
