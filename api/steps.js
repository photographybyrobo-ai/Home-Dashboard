// Steps webhook for Vercel: read-only, mirrors api/trash.js GET.
// Returns the saved steps data (steps.json) for the dashboard Daily
// Activity panel. No POST: Muse updates both the Google Sheet and
// steps.json when Robert logs steps. No fake data — days with no
// logged steps are null.
//
// Reads via the GitHub API, NOT raw.githubusercontent.com: the raw CDN
// serves a stale copy to Vercel's edge for 30+ minutes after a save
// (seen Nov 20, 2026: /api/steps kept returning the pre-Oura file while
// the API and the static /steps.json were already fresh). The API is
// authoritative, so Rachel's steps show up as soon as they are saved.
const {send} = require('./_auth');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  try {
    const token = process.env.GITHUB_TOKEN;
    let data = null;
    if (token) {
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/steps.json`, {
        headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-steps'},
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      }
    }
    if (!data) {
      const r = await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/steps.json`, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) return send(res, 404, {error: 'No steps data saved yet'});
      data = await r.json();
    }
    return send(res, 200, data);
  } catch (e) { return send(res, 502, {error: 'Unable to load steps data'}); }
};
