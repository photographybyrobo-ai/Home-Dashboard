// Oura steps sync for Vercel: deterministic, no AI, no spreadsheet.
// Runs on Vercel Cron (vercel.json) once a day at 1am MST, alongside
// /api/steps-sync, and can also be run by visiting /api/oura-sync.
//   Oura API v2 daily_activity -> Rachel's steps in steps.json.
// Rachel's steps only — Robert's Garmin data in the same file is
// preserved untouched. Oura has no step goal in daily_activity, so
// Rachel's goal stays at the fixed 8,000 already in steps.json.
// Env vars in Vercel:
//   OURA_CLIENT_ID, OURA_CLIENT_SECRET — from Rachel's Oura OAuth app
//   OURA_REFRESH_TOKEN — shown once by /api/oura-callback after Rachel
//     approves; saved in Vercel (Production) by Robert, never in chat
//   GITHUB_TOKEN — already set (same token api/trash.js uses)
const {send, secureEqual} = require('./_auth');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';
const TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const ACTIVITY_URL = 'https://api.ouraring.com/v2/usercollection/daily_activity';
const MILES_PER_STEP_FT = 2.134; // Rachel, 5'2"
const RACHEL_GOAL = 8000;
const DAYS = 8; // today + previous 7 days

function denverDate(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00-07:00');
  d.setDate(d.getDate() + n);
  return denverDate(d);
}
function miles(steps) {
  return Math.round((steps * MILES_PER_STEP_FT / 5280) * 100) / 100;
}

async function githubGetJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-oura-sync'};
  const r = await fetch(api, {headers, signal: AbortSignal.timeout(9000)});
  if (!r.ok) return {data: null, sha: undefined};
  const j = await r.json();
  return {data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha};
}

async function githubPutJson(path, data, message, sha) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-oura-sync'};
  const put = await fetch(api, {
    method: 'PUT', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({message, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), ...(sha ? {sha} : {})}),
    signal: AbortSignal.timeout(9000),
  });
  if (!put.ok) throw new Error('GitHub update failed: ' + put.status);
}

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!given || !secureEqual(given, secret)) return send(res, 401, {error: 'Invalid cron secret'});
  }
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const refreshToken = process.env.OURA_REFRESH_TOKEN;
  if (!clientId || !clientSecret) return send(res, 503, {error: 'Oura client ID/secret not configured in Vercel yet'});
  if (!refreshToken) return send(res, 503, {error: 'OURA_REFRESH_TOKEN not configured in Vercel yet — finish the authorize step first'});
  if (!process.env.GITHUB_TOKEN) return send(res, 503, {error: 'GitHub token not configured in Vercel yet'});

  try {
    // Refresh the short-lived access token from the stored refresh token.
    const tr = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tr.ok) throw new Error('Oura token refresh failed: ' + tr.status + ' — Rachel may need to re-authorize');
    const tokens = await tr.json();
    if (!tokens.access_token) throw new Error('Oura token refresh returned no access token');
    // Oura may rotate the refresh token. It cannot be saved to Vercel
    // from here, so flag it — Robert updates OURA_REFRESH_TOKEN if set.
    const refreshTokenChanged = !!(tokens.refresh_token && tokens.refresh_token !== refreshToken);

    const today = denverDate(new Date());
    const start = addDays(today, -(DAYS - 1));
    const ar = await fetch(
      `${ACTIVITY_URL}?start_date=${start}&end_date=${today}`,
      {headers: {Authorization: 'Bearer ' + tokens.access_token}, signal: AbortSignal.timeout(10000)}
    );
    if (!ar.ok) throw new Error('Oura daily_activity fetch failed: ' + ar.status);
    const aj = await ar.json();
    const stepsByDate = {};
    for (const row of (Array.isArray(aj.data) ? aj.data : [])) {
      if (row.day && typeof row.steps === 'number') stepsByDate[row.day] = row.steps;
    }

    const {data: cur, sha} = await githubGetJson('steps.json');
    const prevDays = {};
    for (const d of (cur && cur.days) || []) prevDays[d.date] = d;

    const days = [];
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(start, i);
      const prev = prevDays[date] || {};
      const rachel = typeof stepsByDate[date] === 'number' ? stepsByDate[date] : (prev.Rachel ?? null);
      days.push({
        date,
        Robert: prev.Robert ?? null,
        Rachel: rachel,
        goal: typeof prev.goal === 'number' ? prev.goal : 6000,
        miles: {
          Robert: (prev.miles && prev.miles.Robert) ?? null,
          Rachel: typeof rachel === 'number' ? miles(rachel) : null,
        },
      });
    }
    const data = {
      days,
      goals: {Robert: (cur && cur.goals && cur.goals.Robert) || 6000, Rachel: RACHEL_GOAL},
      milesPerStepFt: {Robert: 2.375, Rachel: 2.134},
      source: 'Garmin Connect + Oura API (no AI, no spreadsheet)',
      today,
      updatedAt: new Date().toISOString(),
    };
    await githubPutJson('steps.json', data, 'Sync Oura steps ' + start + ' to ' + today, sha);
    return send(res, 200, {ok: true, start, end: today, steps: stepsByDate, refreshTokenChanged, updatedAt: data.updatedAt});
  } catch (e) {
    console.error('Oura sync failed:', e.message);
    return send(res, 502, {error: 'Oura sync failed: ' + e.message});
  }
};
