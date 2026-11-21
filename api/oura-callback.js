// Oura OAuth2 callback for Vercel: deterministic, no AI.
// Oura redirects Rachel here after she approves daily_activity.
// This exchanges the one-time code for an access token + refresh token
// and shows the refresh token ONCE on screen, so Robert can save it in
// Vercel as OURA_REFRESH_TOKEN. The refresh token is NEVER saved to
// GitHub or logged — it only appears on this page, once.
// Env vars in Vercel: OURA_CLIENT_ID, OURA_CLIENT_SECRET.
const {send, sign, secureEqual} = require('./_auth');
const REDIRECT_URI = 'https://home-dashboard-flame.vercel.app/api/oura-callback';
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

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  const code = req.query && req.query.code;
  const error = req.query && req.query.error;
  const state = req.query && req.query.state;
  if (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('Oura connection declined', '<p>Oura returned: ' + esc(error) + '. Rachel can try again from the dashboard authorize link.</p>'));
  }
  if (!code) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('No code from Oura', '<p>Open the authorize link again — this page only works right after Rachel approves in Oura.</p>'));
  }
  // Verify signed state when one was issued (skip when SESSION_SECRET
  // is not set, in which case auth issued a plain random state).
  if (state && state.includes('.') && process.env.SESSION_SECRET) {
    const [exp, sig] = state.split('.');
    if (!exp || !sig || Number(exp) < Date.now() || !secureEqual(sign(exp), sig)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(page('Link expired', '<p>That authorize link has expired (15 minutes). Start again from the dashboard authorize link.</p>'));
    }
  }
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('Oura keys not set yet', '<p>Add OURA_CLIENT_ID and OURA_CLIENT_SECRET to Vercel first, then start the authorize step again.</p>'));
  }
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
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('Could not finish connecting', '<p>' + esc(e.message) + ' — try the authorize step again.</p>'));
  }
  if (!tokens.refresh_token) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('No refresh token from Oura', '<p>Oura did not return a refresh token. Try the authorize step again.</p>'));
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(page('Rachel\u2019s Oura is connected', ''
    + '<p>Save this refresh token in Vercel as <b>OURA_REFRESH_TOKEN</b> (Production), then redeploy. It is shown here once only — do not paste it in chat or share a screenshot of it.</p>'
    + '<p><code style="word-break:break-all;background:#eee;padding:10px;display:block">' + esc(tokens.refresh_token) + '</code></p>'
    + '<p>Scopes granted: ' + esc(tokens.scope || 'daily_activity') + '. Next: add the token in Vercel, redeploy, then visit /api/oura-sync to test the first pull.</p>'));
};
