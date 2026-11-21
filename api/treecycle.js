// Treecycle watcher for Vercel: deterministic, no AI.
// Fetches Denver's public Treecycle page live on every load and reports
// whether this season's drop-off dates have been published yet.
// As of Nov 20, 2026 the page still says "Thank you for a great
// 2025-2026 Treecycle. See you next year!" with last season's dates
// (Dec 29-Jan 30 weekdays 8am-2pm), so published:false until that text
// is replaced by a new season's dates. Never invents dates: dates and
// sites come only from the page text itself.
// Treecycle is a DROP-OFF, not a curbside pickup — never call it one.
const {send} = require('./_auth');
const PAGE_URL = 'https://www.denvergov.org/My-Property/Recycle-Compost-Trash/Seasonal-Programs/Treecycle';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  let text;
  try {
    const r = await fetch(PAGE_URL, {
      headers: {'User-Agent': 'household-hub-treecycle-check'},
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('Treecycle page returned ' + r.status);
    text = stripHtml(await r.text());
  } catch (e) {
    return send(res, 502, {error: 'Unable to load Treecycle page: ' + e.message, link: PAGE_URL});
  }
  const lastSeason = /thank you for a great 2025-2026 treecycle/i.test(text);
  // A new season is published when the thank-you banner is gone and the
  // page carries a fresh "Open December ...-January ..." date range.
  const openM = text.match(/Open\s+(December\s+\d{1,2}\s*-\s*(?:January|February)\s+\d{1,2}[^\n]{0,80})/i);
  const published = !lastSeason && !!openM;
  let sites = [];
  if (published) {
    // Weekday drop sites are listed after the "Open December" line.
    const after = text.slice(text.search(/Open\s+December/i));
    const known = ['Cherry Creek Transfer Station', 'Havana Nursery', 'Central Platte Campus',
      "Sloan\u2019s Lake Park", "Sloan's Lake Park", 'Fred Thomas Park', 'Evie Dennis School Campus',
      'John F. Kennedy High School', 'Bruce Randolph School', 'Carson Elementary',
      'Congress Park', 'University Park Elementary'];
    sites = known.filter(s => after.includes(s));
  }
  const seasonM = text.match(/20\d\d-20\d\d Treecycle/);
  return send(res, 200, {
    published,
    season: lastSeason ? '2025-2026' : (seasonM ? seasonM[0].replace(' Treecycle', '') : null),
    dates: published && openM ? 'Open ' + openM[1].trim() : null,
    sites,
    details: published ? text.slice(text.search(/Open\s+December/i), text.search(/Open\s+December/i) + 900) : null,
    link: PAGE_URL,
    updatedAt: new Date().toISOString(),
    source: 'Denver Treecycle page (no AI)',
  });
};
