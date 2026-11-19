// Steps webhook for Vercel: read-only, mirrors api/trash.js GET.
// Returns the saved steps data (steps.json) for the dashboard Daily
// Activity panel. No POST: Muse updates both the Google Sheet and
// steps.json when Robert logs steps. No fake data — days with no
// logged steps are null.
const {send} = require('./_auth');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/steps.json`, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) return send(res, 404, {error: 'No steps data saved yet'});
    return send(res, 200, await r.json());
  } catch (e) { return send(res, 502, {error: 'Unable to load steps data'}); }
};
