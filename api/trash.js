// Trash collection webhook for Vercel: deterministic, no AI.
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
    holidayNote: /thanksgiving|holiday/i.test(fullText) ? 'Holiday service changes — check email for details' : null,
    subject: body.subject || null,
  };
}

module.exports = async function(req, res) {
  if (req.method === 'GET') {
    // Dashboard read: fetch the saved file from GitHub raw.
    try {
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
