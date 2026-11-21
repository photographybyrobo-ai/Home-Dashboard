// Trash feed for Vercel: deterministic, no AI, no email, no spreadsheet.
// Reads Robert's public ReCollect ICS calendar feed live on every load
// and returns the very next pickup plus the next two large item pickups.
// The feed already lists pickups ~a year ahead (60 events), so future
// dates appear automatically as the feed is updated — nothing is saved
// or snapshotted here, and no cron is needed.
//   Feed: https://recollect-us.global.ssl.fastly.net/api/places/
//   C039F798-699B-11EC-BC71-9ED6BC3FF7F5/services/248/events.en-US.ics
//   Place ID C039F798-699B-11EC-BC71-9ED6BC3FF7F5, Service ID 248,
//   calendar "4354 N Columbine St". Public, no API key, no login.
const {send} = require('./_auth');
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

function cleanDescription(desc) {
  if (!desc) return null;
  const t = desc.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\\;/g, ';')
    .replace(/\*/g, '').replace(/Have a Happy Holiday!?\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!/thanksgiving|holiday|suspended|closed/i.test(t)) return null;
  return t.slice(0, 800) || null;
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

module.exports = async function(req, res) {
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
    holidayNote: cleanDescription(next.description),
    largeItems,
    updatedAt: new Date().toISOString(),
    address: '4354 N Columbine St, Denver',
    source: 'ReCollect ICS feed (no AI, no email)',
  });
};
