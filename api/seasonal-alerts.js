// Compost / mulch giveaway watcher for Vercel: deterministic, no AI.
// Fetches Denver's public Compost Giveaway page live on every load and
// reports whether registration for the spring giveaway has been announced.
// The page currently says "See you Saturday May 1st, 2027" — that is a
// date announcement, NOT an open registration. registrationOpen is true
// only when the page carries a present-tense open-registration signal
// ("registration is open", "register now", "registration now open") and
// is not still showing the closed-season "Thank you Denver" banner.
// Never invents dates: the date comes only from the page text itself.
// Facts: free dig-your-own mulch & compost giveaway each spring; last
// one Sat May 2, 2026 8am-2pm; compost only at Central Platte Campus
// (1271 W Bayaud Ave) with advance registration required for 5 free
// gallons; mulch at four sites.
const {send} = require('./_auth');
const PAGE_URL = 'https://denvergov.org/My-Property/Recycle-Compost-Trash/Seasonal-Programs/Compost-Giveaway';
const MULCH_URL = 'https://denvergov.org/My-Property/Recycle-Compost-Trash/Seasonal-Programs/Mulch-Giveaway';

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
      headers: {'User-Agent': 'household-hub-compost-check'},
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('Compost Giveaway page returned ' + r.status);
    text = stripHtml(await r.text());
  } catch (e) {
    return send(res, 502, {error: 'Unable to load Compost Giveaway page: ' + e.message, link: PAGE_URL});
  }
  const closedSeason = /thank you denver/i.test(text);
  // Date on the page, e.g. "See you Saturday May 1st, 2027".
  const dateM = text.match(/Saturday,?\s+May\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d\d/i);
  const date = dateM
    ? dateM[0].replace(/(\d+)(st|nd|rd|th)/i, '$1').replace(/Saturday,?\s+/i, 'Saturday, ')
    : null;
  const yearM = (date || text).match(/20\d\d/);
  const year = yearM ? Number(yearM[0]) : null;
  // Open registration: present-tense signal, and not the closed-season page.
  const registrationOpen = !closedSeason
    && /registration is open|register now|registration now open|registration has opened|sign up now/i.test(text);
  return send(res, 200, {
    active: registrationOpen,
    registrationOpen,
    year,
    date,
    link: PAGE_URL,
    mulchLink: MULCH_URL,
    updatedAt: new Date().toISOString(),
    source: 'Denver Compost Giveaway page (no AI)',
  });
};
