// Oura OAuth2 start for Vercel: deterministic, no AI.
// Rachel's Oura Ring steps, via OAuth2 — Personal Access Tokens are
// deprecated and can no longer be created (Oura, Dec 2025), so this is
// the only supported route. This endpoint just redirects Rachel to
// Oura to approve one scope: daily_activity (steps only).
// Env vars in Vercel:
//   OURA_CLIENT_ID — from the Oura OAuth app Rachel registers at
//     cloud.ouraring.com/oauth/applications
//   OURA_CLIENT_SECRET — same app (kept in Vercel only, never in chat)
// Redirect URI registered in that app (must match exactly):
//   https://home-dashboard-flame.vercel.app/api/oura-callback
const {send, sign} = require('./_auth');
const crypto = require('node:crypto');
const REDIRECT_URI = 'https://home-dashboard-flame.vercel.app/api/oura-callback';

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  const clientId = process.env.OURA_CLIENT_ID;
  if (!clientId) return send(res, 503, {error: 'OURA_CLIENT_ID not configured in Vercel yet'});
  // Signed state (CSRF protection) when SESSION_SECRET exists; a plain
  // random state otherwise — the callback verifies it only when signed.
  let state;
  try {
    const exp = String(Date.now() + 15 * 60 * 1000);
    state = exp + '.' + sign(exp);
  } catch (e) {
    state = crypto.randomBytes(16).toString('hex');
  }
  const url = 'https://cloud.ouraring.com/oauth/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(REDIRECT_URI)
    + '&scope=' + encodeURIComponent('daily_activity')
    + '&state=' + encodeURIComponent(state);
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
};
