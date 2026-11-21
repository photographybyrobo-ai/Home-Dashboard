// Trash collection webhook + live feed for Vercel: deterministic, no AI.
// One function (Hobby 12-function limit): POST = Denver email webhook,
// GET = saved pickup, GET ?feed=1 = live ReCollect feed.
// Receives a forwarded Denver trash email, checks the sender only,
// parses the pickup date, and saves it to collection.json in GitHub
// via the GitHub API (GITHUB_TOKEN env var in Vercel).
// GET returns the current saved pickup for the dashboard.
const {send, secureEqual} = require('./_auth');
const OWNER = 'photographybyrobo-ai';
const REPO = 'Home-Dashboard';
const SENDER = 'denver-waste@remember.recollect.net';

function parseBody(body) {
  const fullText = [body.subject || '', body.text || '', body.body || '', body.html || ''].join('\n');
  const m = fullText.match(/(?:picked up on|collection[^\n]{0,40}?)\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Z][a-z]{2,8})\s+(\d{1,2}),\s+(\d{4})/i)
    || fullText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Z][a-z]{2,8})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const dateStr = m[0].replace(/^picked up on\s*/i, '').trim();
  // Only the pickup list counts for recycling. The rest of the email
  // mentions recycling in holiday notes / footers, so do NOT scan it.
  // Trash is weekly, compost is normally weekly, recycling is bi-weekly:
  // trash=yes does NOT mean recycling=yes.
  const pickupStart = fullText.search(/will be picked up on/i);
  let pickupText = fullText;
  if (pickupStart >= 0) {
    pickupText = fullText.slice(pickupStart);
    const end = pickupText.search(/\n####|\nLearn where|\n#### /);
    if (end > 0) pickupText = pickupText.slice(0, end);
  }
  const trash = /trash/i.test(pickupText);
  const compost = /compost/i.test(pickupText);
  const recycling = /recycl/i.test(pickupText);
  const items = [];
  if (trash) items.push('Trash');
  if (compost) items.push('Compost');
  if (recycling) items.push('Recycling');
  const summary = items.join(' + ') + (recycling ? '' : ' — No Recycling');
  return {
    nextPickup: dateStr,
    items: items.length ? items : ['Trash'],
    trash, compost, recycling,
    recyclingPickup: recycling,
    summary,
    subject: body.subject || null,
  };
}

// Live ReCollect feed, folded in from the old api/trash-feed.js so the
// project stays under Vercel Hobby's 12-function limit: GET ?feed=1
// returns the next pickup + next two large item pickups, live.

const FEED_URL = 'https://recollect-us.global.ssl.fastly.net/api/places/C039F798-699B-11EC-BC71-9ED6BC3FF7F5/services/248/events.en-US.ics';

function denverToday() {
  // YYYY-MM-DD in America/Denver, then strip dashes -> YYYYMMDD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/-/g, '');
}

function fmtDate(yyyymmdd) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function itemsFromSummary(summary) {
  const s = summary.toLowerCase();
  const items = [];
  if (/trash/.test(s)) items.push('Trash');
  if (/compost/.test(s)) items.push('Compost');
  if (/recycl/.test(s)) items.push('Recycling');
  return items.length ? items : ['Trash'];
}

function parseFeed(ics) {
  // Unfold ICS lines: a line starting with a space continues the previous.
  const unfolded = ics.replace(/\r?\n /g, '');
  const events = [];
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const dateM = body.match(/DTSTART;VALUE=DATE:(\d{8})/);
    const sumM = body.match(/SUMMARY:(.*)/);
    if (!dateM || !sumM) continue;
    const descM = body.match(/DESCRIPTION:(.*)/);
    events.push({
      date: dateM[1],
      summary: sumM[1].replace(/\\,/g, ',').trim(),
      description: descM ? descM[1].trim() : '',
    });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}


async function feedHandler(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  let ics;
  try {
    const r = await fetch(FEED_URL, {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error('ReCollect feed returned ' + r.status);
    ics = await r.text();
  } catch (e) {
    return send(res, 502, {error: 'Unable to load ReCollect feed: ' + e.message});
  }
  const today = denverToday();
  const upcoming = parseFeed(ics).filter(e => e.date >= today);
  if (!upcoming.length) return send(res, 502, {error: 'No upcoming pickups in the ReCollect feed'});
  const next = upcoming[0];
  const items = itemsFromSummary(next.summary);
  const largeItems = upcoming
    .filter(e => /large item/i.test(e.summary))
    .slice(0, 2)
    .map(e => ({date: fmtDate(e.date), dateKey: e.date, items: itemsFromSummary(e.summary)}));
  return send(res, 200, {
    nextPickup: fmtDate(next.date),
    dateKey: next.date,
    items,
    trash: items.includes('Trash'),
    compost: items.includes('Compost'),
    recycling: items.includes('Recycling'),
    recyclingPickup: items.includes('Recycling'),
    largeItems,
    updatedAt: new Date().toISOString(),
    address: '4354 N Columbine St, Denver',
    source: 'ReCollect ICS feed (no AI, no email)',
  });
}

module.exports = async function(req, res) {
  if (req.method === 'GET' && req.query && req.query.feed === '1') return feedHandler(req, res);
  if (req.method === 'GET') {
    // Dashboard read: GitHub API first (authoritative, fresh — the raw
    // CDN serves Vercel's edge a stale copy for 30+ minutes after a save,
    // same as steps.json in Nov 2026), raw as fallback.
    try {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/collection.json`, {
          headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-trash'},
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const j = await r.json();
          return send(res, 200, JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')));
        }
      }
      const r = await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/collection.json`, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) return send(res, 404, {error: 'No collection data saved yet'});
      return send(res, 200, await r.json());
    } catch (e) { return send(res, 502, {error: 'Unable to load collection data'}); }
  }
  if (req.method !== 'POST') return send(res, 405, {error: 'Method not allowed'});

  // Secret check, if one is configured in Vercel.
  const secret = process.env.TRASH_WEBHOOK_SECRET;
  if (secret) {
    const given = req.headers['x-trash-secret'];
    if (!given || !secureEqual(given, secret)) return send(res, 401, {error: 'Invalid webhook secret'});
  }
  // Deterministic sender check only — no AI, no subject matching.
  const from = String((req.body && (req.body.from || req.body.sender)) || req.headers['x-original-sender'] || '');
  const bodyText = JSON.stringify(req.body || '');
  if (!from.toLowerCase().includes(SENDER) && !bodyText.toLowerCase().includes(SENDER)) {
    return send(res, 400, {error: 'Sender is not Denver Waste'});
  }
  const parsed = parseBody(req.body || {});
  if (!parsed) return send(res, 400, {error: 'Could not find a pickup date in the email'});

  const token = process.env.GITHUB_TOKEN;
  if (!token) return send(res, 503, {error: 'GitHub token not configured in Vercel yet', parsed});
  const data = {...parsed, updatedAt: new Date().toISOString(), address: '4354 N Columbine St, Denver'};
  try {
    const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/collection.json`;
    const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'household-hub-trash-webhook'};
    const cur = await fetch(api, {headers, signal: AbortSignal.timeout(9000)});
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const put = await fetch(api, {method: 'PUT', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify({message: 'Update trash pickup: ' + parsed.nextPickup, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), ...(sha ? {sha} : {})}), signal: AbortSignal.timeout(9000)});
    if (!put.ok) throw new Error('GitHub update failed: ' + put.status);
    return send(res, 200, {ok: true, ...data});
  } catch (e) { console.error('Trash webhook save failed:', e.message); return send(res, 502, {error: 'Could not save pickup date', parsed}); }
};
