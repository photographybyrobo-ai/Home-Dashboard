// Compost / mulch giveaway watcher for Vercel: deterministic, no AI.
//
// Why this is layered instead of one phrase: Denver's pages are messy.
// Right now (Nov 2026) the Compost page says "Thank you Denver! … See you
// Saturday May 1st, 2027" AND still shows a "Sign up for the Compost
// Giveaway!" link to a form from last season. So no single signal is safe:
//  - a signup link alone is NOT proof (the old form link is still there)
//  - "thank you denver" alone is NOT proof it is closed (Denver may leave
//    the banner up when registration opens)
//  - one exact phrase alone is NOT proof (Denver may word it differently)
//
// So this checks BOTH pages (Compost-Giveaway and Free-Mulch-Giveaway —
// the old code named the mulch page "Mulch-Giveaway", which 404s), looks
// only at the main content (not nav/footer), and combines signals:
//  - strong: a present-tense open phrase, e.g. "registration is open",
//    "register now", "now accepting registrations"
//  - likely: the closed banner is gone but a signup link is still there,
//    OR the giveaway date changed from the known closed-season date
//    (Sat May 1, 2027), OR a different signup form appeared
//  - stale: only the known old form id and the known closed-season date
//    are present — that is the current closed state, not a false alarm.
//
// The dashboard shows the alert on strong OR likely, with honest wording
// for each. It never invents a date: the date comes only from the page.
// Facts: free dig-your-own mulch & compost giveaway each spring; last
// one Sat May 2, 2026 8am-2pm; compost only at Central Platte Campus
// (1271 W Bayaud Ave) with advance registration required for 5 free
// gallons; mulch at four sites, no registration required.
const {send} = require('./_auth');
const PAGE_URL = 'https://denvergov.org/My-Property/Recycle-Compost-Trash/Seasonal-Programs/Compost-Giveaway';
const MULCH_URL = 'https://denvergov.org/My-Property/Recycle-Compost-Trash/Seasonal-Programs/Free-Mulch-Giveaway';

// Known closed-season baseline, Nov 2026. If either changes, that alone
// is worth surfacing — Denver has updated the page.
const KNOWN_CLOSED_DATE = 'Saturday, May 1, 2027';
const KNOWN_FORM_ID = 'b2df702b-8207-4076-b4eb-9f4e706a0aff';

const OPEN_PHRASES = [
  /registration is open/i,
  /registration now open/i,
  /registration has opened/i,
  /registration is now open/i,
  /now accepting registrations/i,
  /registration opens (today|now)/i,
  /register now/i,
  /sign up now/i,
  /sign up today/i,
  /click here to register/i,
  /reserve your (spot|compost)/i,
];

function mainContent(html) {
  const m = html.match(/id=["']main-content["'][\s\S]*?(?=<footer)/i);
  return m ? m[0] : html;
}

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

function extractLinks(html) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const label = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
    out.push({href, label});
  }
  return out;
}

function normalizeDate(raw) {
  if (!raw) return null;
  let d = raw.replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ').trim();
  d = d.replace(/^(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)\s+(?!,\s)/i, '$1, ');
  return d;
}

async function fetchPage(url) {
  try {
    const r = await fetch(url, {
      headers: {'User-Agent': 'household-hub-compost-check'},
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return {url, ok: false, status: r.status, text: '', links: []};
    const html = await r.text();
    const main = mainContent(html);
    return {url, ok: true, status: r.status, text: stripHtml(main), links: extractLinks(main)};
  } catch (e) {
    return {url, ok: false, status: null, error: String(e && e.message || e), text: '', links: []};
  }
}

module.exports = async function(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});

  const pages = await Promise.all([fetchPage(PAGE_URL), fetchPage(MULCH_URL)]);
  const good = pages.filter(p => p.ok);
  if (!good.length) {
    return send(res, 502, {
      error: 'Unable to load Denver giveaway pages',
      link: PAGE_URL,
      pagesChecked: pages.map(p => ({url: p.url, ok: p.ok, status: p.status || null})),
    });
  }

  const text = good.map(p => p.text).join('\n');
  const links = good.flatMap(p => p.links);
  const signals = [];

  // Closed banner: only the intro counts — the banner sits at the top of
  // the main content. Checking the whole page would catch it in footers
  // and recaps long after it stopped being the current state.
  const intro = good.map(p => p.text.slice(0, 800)).join('\n');
  const closedBanner = /thank you denver/i.test(intro) || /see you (saturday )?may/i.test(intro);
  if (closedBanner) signals.push('closed-banner-present');

  // Strong open phrases, in main content only.
  const openHits = OPEN_PHRASES.filter(re => re.test(text)).map(re => re.source);
  if (openHits.length) signals.push('open-phrase: ' + openHits[0]);

  // Signup / registration links and forms, in main content only.
  const signupLinks = links.filter(l =>
    /sign ?up|register|reserve|registration/i.test(l.label) ||
    /openforms|eventbrite|forms\.gle|signup|register/i.test(l.href)
  );
  if (signupLinks.length) signals.push('signup-link-present: ' + signupLinks[0].label);
  const formIds = [];
  for (const l of links) {
    const m = l.href.match(/openforms\.com\/Form\/([A-Za-z0-9-]+)/i);
    if (m) formIds.push(m[1]);
  }
  const formChanged = formIds.length > 0 && !formIds.includes(KNOWN_FORM_ID);
  if (formChanged) signals.push('new-form-id: ' + formIds[0]);
  if (formIds.includes(KNOWN_FORM_ID)) signals.push('stale-form-id-only');

  // Dates: any "May 1, 2027" style date, preferring a Saturday one.
  const dateMatches = [...text.matchAll(/(?:Saturday,?\s+)?May\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d\d/gi)]
    .map(m => normalizeDate(m[0]));
  const date = dateMatches.find(d => /^Saturday/i.test(d)) || dateMatches[0] || null;
  const dateChanged = !!date && date !== KNOWN_CLOSED_DATE;
  if (dateChanged) signals.push('date-changed: ' + date);
  if (date === KNOWN_CLOSED_DATE) signals.push('known-closed-date-only');
  const yearM = (date || text).match(/20\d\d/);
  const year = yearM ? Number(yearM[0]) : null;

  // Decision: strong phrase wins over the banner; otherwise a likely
  // signal needs the banner gone, a new form, or a new date.
  const registrationOpen = openHits.length > 0;
  const registrationLikely = !registrationOpen && (
    (signupLinks.length > 0 && !closedBanner) || formChanged || dateChanged
  );
  const active = registrationOpen || registrationLikely;
  const confidence = registrationOpen ? 'high' : (registrationLikely ? 'medium' : 'low');
  if (!active) signals.push('no-open-signal');

  // Prefer a real signup link as the destination, otherwise the page.
  const signupLink = signupLinks.length ? signupLinks[0].href : null;

  return send(res, 200, {
    active,
    registrationOpen,
    registrationLikely,
    confidence,
    signals,
    year,
    date,
    link: signupLink || PAGE_URL,
    pageLink: PAGE_URL,
    mulchLink: MULCH_URL,
    pagesChecked: pages.map(p => ({url: p.url, ok: p.ok, status: p.status || null})),
    updatedAt: new Date().toISOString(),
    source: 'Denver Compost + Mulch Giveaway pages (no AI)',
  });
};
