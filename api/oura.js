// Oura OAuth2 for Vercel: deterministic, no AI. ONE function for both
// steps of the handshake, to stay under Vercel Hobby's 12-function limit.
//   GET /api/oura                    -> redirects Rachel to Oura to approve
//                                      daily (sleep/activity/readiness summaries — includes steps)
//   GET /api/oura?step=callback     -> Oura redirects back here with a code;
//                                      exchanges it and shows the refresh
//                                      token ONCE, so Robert can save it in
//                                      Vercel as OURA_REFRESH_TOKEN. The token
//                                      is NEVER saved to GitHub or logged.
// Personal Access Tokens are deprecated and can no longer be created
// (Oura, Dec 2025), so OAuth2 is the only supported route.
// Register this exact redirect URI in the Oura app at
// cloud.ouraring.com/oauth/applications:
//   https://home-dashboard-flame.vercel.app/api/oura?step=callback
// Env vars in Vercel: OURA_CLIENT_ID, OURA_CLIENT_SECRET.
const {send, sign, secureEqual} = require('./_auth');
const {saveRefreshToken} = require('./_oura-token');
const crypto = require('node:crypto');
const REDIRECT_URI = 'https://home-dashboard-flame.vercel.app/api/oura?step=callback';
const TOKEN_URL = 'https://api.ouraring.com/oauth/token';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function page(title, body) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6">'
    + '<h1>' + esc(title) + '</h1>' + body + '</body>';
}
function html(res, status, title, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(page(title, body));
}

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  const step = (req.query && req.query.step) || 'auth';

  if (step === 'auth') {
    const clientId = process.env.OURA_CLIENT_ID;
    if (!clientId) return send(res, 503, {error: 'OURA_CLIENT_ID not configured in Vercel yet'});
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
      + '&scope=' + encodeURIComponent('daily')
      + '&state=' + encodeURIComponent(state);
    res.statusCode = 302;
    res.setHeader('Location', url);
    return res.end();
  }

  if (step === 'callback') {
    const code = req.query && req.query.code;
    const error = req.query && req.query.error;
    const state = req.query && req.query.state;
    if (error) return html(res, 400, 'Oura connection declined', '<p>Oura returned: ' + esc(error) + '. Rachel can try again from the dashboard authorize link.</p>');
    if (!code) return html(res, 400, 'No code from Oura', '<p>Open the authorize link again — this page only works right after Rachel approves in Oura.</p>');
    if (state && state.includes('.') && process.env.SESSION_SECRET) {
      const [exp, sig] = state.split('.');
      if (!exp || !sig || Number(exp) < Date.now() || !secureEqual(sign(exp), sig)) {
        return html(res, 400, 'Link expired', '<p>That authorize link has expired (15 minutes). Start again from the dashboard authorize link.</p>');
      }
    }
    const clientId = process.env.OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;
    if (!clientId || !clientSecret) return html(res, 503, 'Oura keys not set yet', '<p>Add OURA_CLIENT_ID and OURA_CLIENT_SECRET to Vercel first, then start the authorize step again.</p>');
    let tokens;
    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error('Oura token exchange failed: ' + r.status);
      tokens = await r.json();
    } catch (e) {
      return html(res, 502, 'Could not finish connecting', '<p>' + esc(e.message) + ' — try the authorize step again.</p>');
    }
    if (!tokens.refresh_token) return html(res, 502, 'No refresh token from Oura', '<p>Oura did not return a refresh token. Try the authorize step again.</p>');
    // Oura refresh tokens are single-use, so the token must be saved
    // where the sync can read it next time. It is stored encrypted in
    // GitHub (see api/_oura-token.js) — never shown on screen.
    let saved = false;
    let saveError = null;
    try { await saveRefreshToken(tokens.refresh_token); saved = true; }
    catch (e) { saveError = e.message; console.error('Oura token save failed:', e.message); }
    if (saved) {
      return html(res, 200, 'Rachel\u2019s Oura is connected',
        '<p>Done — her login is saved (encrypted) and the dashboard will pull her steps in the daily sync. Scopes granted: ' + esc(tokens.scope || 'daily') + '. You can test it now from the dashboard\u2019s Sync now button.</p>');
    }
    // Fallback if the encrypted save failed: show the token once, so
    // Robert can save it in Vercel as OURA_REFRESH_TOKEN instead.
    return html(res, 200, 'Rachel\u2019s Oura is connected — one manual step',
      '<p>Automatic save failed (' + esc(saveError || 'unknown') + '). Save this refresh token in Vercel as <b>OURA_REFRESH_TOKEN</b> (Production), then redeploy. It is shown here once only — do not paste it in chat or share a screenshot of it.</p>'
      + '<p><code style="word-break:break-all;background:#eee;padding:10px;display:block">' + esc(tokens.refresh_token) + '</code></p>'
      + '<p>Scopes granted: ' + esc(tokens.scope || 'daily') + '.</p>');
  }

  return send(res, 400, {error: 'Unknown step'});
};
