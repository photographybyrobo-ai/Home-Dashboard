// Steps sync for Vercel: deterministic, no AI, no spreadsheet, no Muse.
// Runs on Vercel Cron (vercel.json) once a day, and can also be run by
// visiting /api/steps-sync in a browser (GET) to test it.
//   Garmin Connect Personal API (Robert) + Oura API v2 (Rachel)
//   -> steps.json in GitHub -> dashboard.
// Oura lives in this same function (not a separate one) to stay under
// Vercel Hobby's 12-function limit. If Oura is not configured yet, the
// Garmin half still syncs and Oura is skipped silently.
// Env vars in Vercel:
//   GARMIN_PERSONAL_API_KEY — create in Garmin Connect web, Settings ->
//     Personal API, choose 1 year, copy it once. Garmin emails before expiry.
//   OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REFRESH_TOKEN — Rachel's
//     Oura OAuth2 app (see api/oura.js); refresh token shown once by
//     /api/oura?step=callback after she approves.
//   GITHUB_TOKEN — already set (same token api/trash.js uses).
//   CRON_SECRET — optional. If set, Vercel Cron must send it as
//     Authorization: Bearer <CRON_SECRET>. If unset, the endpoint runs
//     without that check (still GET-only).
const {send, secureEqual} = require('./_auth');
const {loadRefreshToken, saveRefreshToken} = require('./_oura-token');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';
const GARMIN_BASE = 'https://personal.connectapi.garmin.com';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_ACTIVITY_URL = 'https://api.ouraring.com/v2/usercollection/daily_activity';
const MILES_PER_STEP_FT = 2.375;
const RACHEL_MILES_PER_STEP_FT = 2.134; // Rachel, 5'2"
const RACHEL_GOAL = 8000; // Fallback only. Oura daily_activity has no step
// goal, so Rachel's goal is a rolling average instead: each day, the
// average of her steps over the previous 7 days (Robert's choice,
// Nov 20, 2026). Recomputed on every sync.
const DEFAULT_GOAL = 6000; // fallback only when Garmin returns no stepGoal
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

async function garminToken(apiKey) {
  const r = await fetch(
    `${GARMIN_BASE}/personalapitoken-service/personal-api/personal-api-key/token`,
    {method: 'POST', headers: {Authorization: 'ApiKey ' + apiKey}, signal: AbortSignal.timeout(10000)}
  );
  if (!r.ok) throw new Error('Garmin token exchange failed: ' + r.status);
  // Garmin returns the token as a plain JWT string (eyJ...), not JSON.
  const text = (await r.text()).trim().replace(/^"|"$/g, '');
  if (text.startsWith('eyJ')) return text;
  try {
    const j = JSON.parse(text);
    const token = j.access_token || j.token || j.accessToken;
    if (token) return token;
  } catch (e) { /* fall through */ }
  throw new Error('Garmin token exchange returned no token');
}

async function garminSteps(token, start, end) {
  const r = await fetch(
    `${GARMIN_BASE}/usersummary-service/stats/steps/daily/${start}/${end}`,
    {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(10000)}
  );
  if (!r.ok) throw new Error('Garmin steps fetch failed: ' + r.status);
  const j = await r.json();
  // Response is an array: [{calendarDate, totalSteps, totalDistance, stepGoal, ...}]
  // stepGoal is the user's daily goal in Garmin Connect, per day.
  const out = {};
  for (const row of (Array.isArray(j) ? j : j.steps || [])) {
    const date = row.calendarDate || row.date;
    const steps = row.totalSteps ?? row.steps;
    const goal = typeof row.stepGoal === 'number' ? row.stepGoal : null;
    if (date && typeof steps === 'number') out[date] = {steps, goal};
  }
  return out;
}

async function ouraSteps(start, end) {
  // Returns {stepsByDate, refreshTokenChanged, tokenSaved} or throws.
  // Caller decides whether a failure should fail the whole sync (it
  // should not — Garmin data is still worth saving).
  // Oura refresh tokens are SINGLE-USE: every refresh returns a new one
  // and invalidates the old, so the new token is saved (encrypted) for
  // the next run — see api/_oura-token.js. Without that, sync #2 fails.
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const refreshToken = await loadRefreshToken();
  if (!clientId || !clientSecret || !refreshToken) return null; // not set up yet
  const tr = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Household-Hub/1.0'},
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
  const refreshTokenChanged = !!(tokens.refresh_token && tokens.refresh_token !== refreshToken);
  let tokenSaved = !refreshTokenChanged;
  if (refreshTokenChanged) {
    try { await saveRefreshToken(tokens.refresh_token); tokenSaved = true; }
    catch (e) { console.error('Oura rotated token save failed:', e.message); tokenSaved = false; }
  }
  const ar = await fetch(
    `${OURA_ACTIVITY_URL}?start_date=${start}&end_date=${end}`,
    {headers: {Authorization: 'Bearer ' + tokens.access_token, 'User-Agent': 'Household-Hub/1.0'}, signal: AbortSignal.timeout(10000)}
  );
  if (!ar.ok) throw new Error('Oura daily_activity fetch failed: ' + ar.status);
  const aj = await ar.json();
  const stepsByDate = {};
  for (const row of (Array.isArray(aj.data) ? aj.data : [])) {
    if (row.day && typeof row.steps === 'number') stepsByDate[row.day] = row.steps;
  }
  return {stepsByDate, refreshTokenChanged, tokenSaved};
}

async function githubGetJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-steps-sync'};
  const r = await fetch(api, {headers, signal: AbortSignal.timeout(9000)});
  if (!r.ok) return {data: null, sha: undefined};
  const j = await r.json();
  return {data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha};
}

async function githubPutJson(path, data, message, sha) {
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-steps-sync'};
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
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY;
  if (!apiKey) return send(res, 503, {error: 'Garmin API key not configured in Vercel yet'});
  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) return send(res, 503, {error: 'GitHub token not configured in Vercel yet'});

  try {
    const today = denverDate(new Date());
    const start = addDays(today, -(DAYS - 1));
    const token = await garminToken(apiKey);
    const stepsByDate = await garminSteps(token, start, today);
    // Rachel's Oura steps, best-effort: a failure here must not lose
    // Robert's Garmin data, so it is caught and reported, not thrown.
    let oura = null;
    let ouraError = null;
    try { oura = await ouraSteps(start, today); }
    catch (e) { ouraError = e.message; console.error('Oura sync skipped:', e.message); }
    const rachelByDate = (oura && oura.stepsByDate) || {};

    const {data: cur, sha} = await githubGetJson('steps.json');
    const prevDays = {};
    for (const d of (cur && cur.days) || []) prevDays[d.date] = d;

    const days = [];
    let lastGoal = null;
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(start, i);
      const prev = prevDays[date] || {};
      const row = stepsByDate[date];
      const steps = row ? row.steps : undefined;
      const robert = typeof steps === 'number' ? steps : (prev.Robert ?? null);
      const rachel = typeof rachelByDate[date] === 'number' ? rachelByDate[date] : (prev.Rachel ?? null);
      // Goal comes from Garmin's stepGoal for that day; fall back to the
      // previously stored goal for that date, then to the last known goal
      // from an earlier day (so a brand-new today is not 6000 just because
      // Garmin has not set today's auto goal yet), then to 6000.
      // A stored 6000 is the old fallback, not a real Garmin goal, so it
      // must not win over the last known goal.
      const storedGoal = (typeof prev.goal === 'number' && prev.goal !== DEFAULT_GOAL) ? prev.goal : null;
      const goal = (row && typeof row.goal === 'number') ? row.goal
        : (storedGoal ?? lastGoal ?? DEFAULT_GOAL);
      if (typeof goal === 'number') lastGoal = goal;
      days.push({
        date,
        Robert: robert,
        Rachel: rachel,
        goal,
        miles: {Robert: typeof robert === 'number' ? miles(robert) : null, Rachel: typeof rachel === 'number' ? Math.round((rachel * RACHEL_MILES_PER_STEP_FT / 5280) * 100) / 100 : null},
      });
    }
    const todayGoal = (days[days.length - 1] && days[days.length - 1].goal) || DEFAULT_GOAL;
    // Rachel's goal: average of her steps over the 7 days before today
    // (today is still in progress, so it is excluded). Falls back to
    // 8,000 if there is no prior data yet.
    const rachelPrior = days.slice(0, -1).map(d => d.Rachel).filter(v => typeof v === 'number');
    const rachelGoal = rachelPrior.length
      ? Math.round(rachelPrior.reduce((a, b) => a + b, 0) / rachelPrior.length)
      : RACHEL_GOAL;
    const data = {
      days,
      goals: {Robert: todayGoal, Rachel: rachelGoal},
      milesPerStepFt: {Robert: 2.375, Rachel: 2.134},
      source: 'Garmin Connect + Oura API (no AI, no spreadsheet)',
      today,
      updatedAt: new Date().toISOString(),
    };
    await githubPutJson('steps.json', data, 'Sync Garmin steps ' + start + ' to ' + today, sha);
    return send(res, 200, {ok: true, start, end: today, steps: stepsByDate, rachelSteps: rachelByDate, ouraConfigured: !!oura, ouraError, refreshTokenChanged: !!(oura && oura.refreshTokenChanged), ouraTokenSaved: !!(oura && oura.tokenSaved), updatedAt: data.updatedAt});
  } catch (e) {
    console.error('Steps sync failed:', e.message);
    return send(res, 502, {error: 'Steps sync failed: ' + e.message});
  }
};
