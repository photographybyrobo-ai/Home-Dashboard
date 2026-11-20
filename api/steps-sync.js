// Steps sync for Vercel: deterministic, no AI, no spreadsheet, no Muse.
// Runs on Vercel Cron (vercel.json) once a day, and can also be run by
// visiting /api/steps-sync in a browser (GET) to test it.
//   Garmin Connect Personal API -> steps.json in GitHub -> dashboard.
// Robert's steps only for now (Rachel / Oura is a later step).
// Env vars in Vercel:
//   GARMIN_PERSONAL_API_KEY — create in Garmin Connect web, Settings ->
//     Personal API, choose 1 year, copy it once. Garmin emails before expiry.
//   GITHUB_TOKEN — already set (same token api/trash.js uses).
//   CRON_SECRET — optional. If set, Vercel Cron must send it as
//     Authorization: Bearer <CRON_SECRET>. If unset, the endpoint runs
//     without that check (still GET-only).
const {send, secureEqual} = require('./_auth');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';
const GARMIN_BASE = 'https://personal.connectapi.garmin.com';
const MILES_PER_STEP_FT = 2.375;
const GOAL = 6000;
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
  const out = {};
  for (const row of (Array.isArray(j) ? j : j.steps || [])) {
    const date = row.calendarDate || row.date;
    const steps = row.totalSteps ?? row.steps;
    if (date && typeof steps === 'number') out[date] = steps;
  }
  return out;
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

    const {data: cur, sha} = await githubGetJson('steps.json');
    const prevDays = {};
    for (const d of (cur && cur.days) || []) prevDays[d.date] = d;

    const days = [];
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(start, i);
      const prev = prevDays[date] || {};
      const steps = stepsByDate[date];
      const robert = typeof steps === 'number' ? steps : (prev.Robert ?? null);
      days.push({
        date,
        Robert: robert,
        Rachel: prev.Rachel ?? null,
        miles: {Robert: typeof robert === 'number' ? miles(robert) : null, Rachel: (prev.miles && prev.miles.Rachel) ?? null},
      });
    }
    const data = {
      days,
      goals: {Robert: GOAL, Rachel: 8000},
      milesPerStepFt: {Robert: 2.375, Rachel: 2.134},
      source: 'Garmin Connect Personal API (no AI, no spreadsheet)',
      today,
      updatedAt: new Date().toISOString(),
    };
    await githubPutJson('steps.json', data, 'Sync Garmin steps ' + start + ' to ' + today, sha);
    return send(res, 200, {ok: true, start, end: today, steps: stepsByDate, updatedAt: data.updatedAt});
  } catch (e) {
    console.error('Steps sync failed:', e.message);
    return send(res, 502, {error: 'Steps sync failed: ' + e.message});
  }
};
