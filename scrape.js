#!/usr/bin/env node
// Clean-room scraper for animefillerlist.com -> AniList filler-episode map.
//
// Output shape (matches the third-party file we're replacing):
//   { "<anilistId>": [<ascending filler episode numbers>], ... }
//
// Only rows classed "filler" count as filler for this dataset. Rows classed
// "mixed_canon/filler" contain real story content and are deliberately
// excluded -- see README.md for the evidence behind that call.
//
// robots.txt on animefillerlist.com sets Crawl-delay: 10. This script
// enforces a 10s gap between every request to that host and never issues
// concurrent requests to it. A full run over ~356 shows takes about an hour.
// Results are cached to disk so a failed/interrupted run does not have to
// restart from zero.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const SHOWS_CACHE_DIR = path.join(CACHE_DIR, 'shows');
const ANILIST_CACHE_DIR = path.join(CACHE_DIR, 'anilist');
const OUTPUT_PATH = path.join(__dirname, 'filler.json');

const AFL_ORIGIN = 'https://www.animefillerlist.com';
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const USER_AGENT =
  'filler-data-scraper/1.0 (+https://github.com/ake-app/filler-data; ' +
  'non-commercial dataset build, respects robots.txt Crawl-delay)';

// robots.txt: Crawl-delay: 10. Applies to animefillerlist.com only.
const AFL_CRAWL_DELAY_MS = 10_000;
// AniList has no published crawl-delay for anonymous GraphQL queries; stay
// conservative anyway since we're an anonymous, unauthenticated client.
const ANILIST_DELAY_MS = 1_500;

const args = process.argv.slice(2);
function flagValue(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}
const LIMIT = flagValue('limit', null);
const limitCount = LIMIT ? parseInt(LIMIT, 10) : Infinity;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirs() {
  await mkdir(SHOWS_CACHE_DIR, { recursive: true });
  await mkdir(ANILIST_CACHE_DIR, { recursive: true });
}

export function slugToCacheFile(dir, slug, ext) {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safe}.${ext}`);
}

let lastAflFetchAt = 0;
export async function fetchAfl(urlPath, cacheFile) {
  if (cacheFile && existsSync(cacheFile)) {
    return readFile(cacheFile, 'utf8');
  }
  const wait = AFL_CRAWL_DELAY_MS - (Date.now() - lastAflFetchAt);
  if (wait > 0) await sleep(wait);
  const res = await fetch(`${AFL_ORIGIN}${urlPath}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  lastAflFetchAt = Date.now();
  if (!res.ok) throw new Error(`AFL fetch failed ${res.status}: ${urlPath}`);
  const text = await res.text();
  if (cacheFile) await writeFile(cacheFile, text, 'utf8');
  return text;
}

// --- Show index parsing -----------------------------------------------

export function parseShowIndex(html) {
  const shows = [];
  const linkRe = /<a href="\/shows\/([^"?#]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = linkRe.exec(html))) {
    const slug = decodeURIComponent(m[1]);
    const title = m[2].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
    shows.push({ slug, title });
  }
  // The index page repeats entries in a "Most Popular" sidebar; de-dupe by slug.
  const seen = new Set();
  return shows.filter((s) => {
    if (seen.has(s.slug)) return false;
    seen.add(s.slug);
    return true;
  });
}

// --- Show page parsing ---------------------------------------------------

export function parseShowPage(html) {
  const rowRe = /<tr class="([^"]+)" id="eps-(\d+)">/g;
  const filler = [];
  const mixed = [];
  let m;
  while ((m = rowRe.exec(html))) {
    const cls = m[1];
    const num = parseInt(m[2], 10);
    if (cls.startsWith('filler')) filler.push(num);
    else if (cls.startsWith('mixed_canon/filler')) mixed.push(num);
  }
  // Some pages list an episode twice (a two-parter, or a re-air), so the same
  // eps-N id appears in two rows. Deduplicate: the contract is an ascending
  // set of episode numbers, and a repeat carries no extra information.
  const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);
  return { filler: uniqSorted(filler), mixed: uniqSorted(mixed) };
}

// Total episodes the show page lists. Used to disambiguate AniList candidates
// -- a series and its sequel share a title but not an episode count.
export function countEpisodeRows(html) {
  return (html.match(/<tr class="[^"]+" id="eps-\d+">/g) || []).length;
}

// Pages that re-classify a show someone else's way rather than describing a
// different anime. They resolve to the same AniList id as the canonical page.
export const ALTERNATE_LIST_SLUG = /-(definitive-filler-list|manga-canon)$/;

// --- Collection pages (films / OVAs / specials) ---------------------------
//
// "One Piece Films" is not a show whose episodes are numbered 1..n -- each row
// is a separate work with its own AniList entry. The dataset we replace stores
// each as its own id with the value [1], meaning the whole film is filler.
// These pages therefore need a different pass: resolve per ROW, not per PAGE.

export const COLLECTION_H1 = /\s+(Films?|Movies?|OVAs?|OADs?|Specials?)$/i;

export function collectionFranchise(html) {
  const m = /<h1>([^<]*)<\/h1>/.exec(html);
  if (!m) return null;
  const name = m[1].replace(/\s*Filler List\s*$/i, '').trim();
  return COLLECTION_H1.test(name) ? name.replace(COLLECTION_H1, '').trim() : null;
}

export function parseCollectionPage(html) {
  const franchise = collectionFranchise(html);
  if (franchise === null) return null;
  const rowRe =
    /<tr class="([^"]+)" id="eps-(\d+)"><td class="Number">\d+<\/td><td class="Title"><a href="\/shows\/[^/"]+\/([^"]+)"[^>]*>([^<]*)<\/a>/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(html))) {
    rows.push({
      episode: parseInt(m[2], 10),
      filmSlug: decodeURIComponent(m[3]),
      title: m[4].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim(),
      filler: m[1].startsWith('filler'),
    });
  }
  return { franchise, rows };
}

// A film's own title is often already qualified ("One Piece: The Movie") but
// just as often is not ("Clockwork Island Adventure"), and searching the bare
// form matches something unrelated. Prefix the franchise only when the title
// does not already carry it.
export function filmSearchKey(franchise, title) {
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const f = flat(franchise);
  const t = flat(title);
  if (!f) return title;
  return t.includes(f) ? title : `${franchise} ${title}`;
}

// AniList's fuzzy search returns nothing at all for some franchise-prefixed
// keys ("Hunter x Hunter (2011) Phantom Rouge"). The bare row title is a second
// query to try, never a looser rule: whatever it returns is still graded
// against the franchise-qualified key.
export function filmSearchTerms(franchise, title) {
  const terms = [filmSearchKey(franchise, title)];
  const bare = (title || '').trim();
  if (bare && bare !== terms[0]) terms.push(bare);
  return terms;
}

// Films must not match a TV series. Restricting the format is what stops
// "Dragon Ball Films / Curse of the Blood Rubies" resolving to Dragon Ball.
export const FILM_FORMATS = new Set(['MOVIE', 'OVA', 'SPECIAL', 'ONA']);

// Deliberately stricter than the series matcher: a wrong film match writes a
// [1] onto an unrelated work, and there is no episode count to catch it.
export function pickFilmCandidate(candidates, searchKey) {
  const flat = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const want = flat(searchKey);
  const eligible = candidates.filter((m) => FILM_FORMATS.has(m.format));
  if (eligible.length === 0) return null;
  const exact = eligible.filter(
    (m) => flat(m.title?.romaji) === want || flat(m.title?.english) === want
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // ambiguous -- omit rather than guess
  return null; // no exact match: omission is benign, a wrong match is not
}

// --- AniList resolution ---------------------------------------------------

// Ask for several candidates rather than AniList's single best guess: its
// fuzzy search reliably picks the wrong entry for year- and season-
// disambiguated titles (searching "Hunter x Hunter" returns the 1999 series
// even when the page is the 2011 one). We re-rank the candidates ourselves
// using the episode count the show page actually has.
const ANILIST_QUERY = `
query ($search: String) {
  Page(perPage: 8) {
    media(search: $search, type: ANIME) {
      id
      episodes
      startDate { year }
      title { romaji english }
    }
  }
}`;

let lastAnilistFetchAt = 0;
async function anilistSearch(search) {
  const wait = ANILIST_DELAY_MS - (Date.now() - lastAnilistFetchAt);
  if (wait > 0) await sleep(wait);
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search } }),
  });
  lastAnilistFetchAt = Date.now();
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    await sleep((retryAfter + 1) * 1000);
    return anilistSearch(search);
  }
  if (!res.ok) return { error: res.status, media: [] };
  const json = await res.json();
  return { error: null, media: json?.data?.Page?.media ?? [] };
}

// Normalise for title comparison: AFL writes "Hunter × Hunter", AniList writes
// "Hunter x Hunter", and neither is consistent about punctuation or case.
function normaliseTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[×✕✖]/g, 'x')
    .replace(/[☆★]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Choose among AniList's candidates. Order matters:
//
//   1. an exact title match wins outright -- "Clannad" must not lose to
//      "Clannad: After Story" just because the page's row count happens to
//      equal After Story's episode count;
//   2. otherwise fall back to the episode count from the show page, which is
//      the only signal that separates a series from its sequel when the
//      titles are near-identical;
//   3. otherwise take AniList's own ranking.
export function pickCandidate(candidates, episodeCount, aflTitle = null) {
  if (candidates.length === 0) return null;

  if (aflTitle) {
    const want = normaliseTitle(aflTitle);
    const wantStripped = normaliseTitle(aflTitle.replace(/\s*\([^)]*\)\s*$/, ''));
    const exact = candidates.filter(
      (m) =>
        normaliseTitle(m.title?.romaji) === want ||
        normaliseTitle(m.title?.english) === want
    );
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      return exact.find((m) => m.episodes === episodeCount) ?? exact[0];
    }
    const exactStripped = candidates.filter(
      (m) =>
        normaliseTitle(m.title?.romaji) === wantStripped ||
        normaliseTitle(m.title?.english) === wantStripped
    );
    if (exactStripped.length === 1) return exactStripped[0];
    if (exactStripped.length > 1) {
      return exactStripped.find((m) => m.episodes === episodeCount) ?? exactStripped[0];
    }
  }

  if (episodeCount) {
    const byCount = candidates.filter((m) => m.episodes === episodeCount);
    if (byCount.length >= 1) return byCount[0];
  }
  return candidates[0];
}

// A show page that lists more episodes than the AniList entry has is a
// FRANCHISE page: animefillerlist numbers the whole run continuously
// (Highschool DxD is 1-48 across four 12-episode seasons) while an AniList id
// addresses one season. Episode numbers past the entry's length belong to
// later seasons and can never match, so keying them here is meaningless --
// and if the id were a later season they would be actively wrong. Keep only
// what the entry can actually contain.
export function trimToEntry(filler, entryEpisodes) {
  if (!entryEpisodes) return { kept: filler, dropped: 0 };
  const kept = filler.filter((n) => n <= entryEpisodes);
  return { kept, dropped: filler.length - kept.length };
}

export async function resolveAnilistMedia(title, cacheFile, episodeCount = null) {
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    return cached.id ? { id: cached.id, episodes: cached.matchedEpisodes ?? null } : null;
  }
  // Search the FULL title first. The trailing parenthetical is usually the
  // disambiguator ("Hunter x Hunter (2011)"), so discarding it up front is
  // what collapses distinct series onto one id. Only fall back to the
  // stripped form when the full title finds nothing.
  const stripped = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  let { error, media } = await anilistSearch(title);
  if (media.length === 0 && stripped && stripped !== title) {
    ({ error, media } = await anilistSearch(stripped));
  }
  if (media.length === 0) {
    await writeFile(cacheFile, JSON.stringify({ id: null, error: error ?? 'no match' }), 'utf8');
    return null;
  }
  const chosen = pickCandidate(media, episodeCount, title);
  const id = chosen?.id ?? null;
  await writeFile(
    cacheFile,
    JSON.stringify({ id, title, matchedEpisodes: chosen?.episodes ?? null, pageEpisodes: episodeCount }),
    'utf8'
  );
  return id ? { id, episodes: chosen?.episodes ?? null } : null;
}

export async function resolveAnilistId(title, cacheFile, episodeCount = null) {
  const media = await resolveAnilistMedia(title, cacheFile, episodeCount);
  return media?.id ?? null;
}

// --- Main -----------------------------------------------------------------

async function main() {
  await ensureDirs();

  console.log('Fetching show index...');
  const indexHtml = await fetchAfl('/shows', path.join(CACHE_DIR, 'shows-index.html'));
  const allShows = parseShowIndex(indexHtml);
  console.log(`Found ${allShows.length} shows.`);

  const shows = allShows.slice(0, limitCount);
  console.log(`Processing ${shows.length} shows (limit=${LIMIT ?? 'none'}).`);

  const result = {};
  const seenBy = {};
  const collisions = [];
  const trimmed = [];
  let processed = 0;
  for (const show of shows) {
    processed += 1;
    const showCacheFile = slugToCacheFile(SHOWS_CACHE_DIR, show.slug, 'html');
    let html;
    try {
      html = await fetchAfl(`/shows/${show.slug}`, showCacheFile);
    } catch (err) {
      console.error(`  [${processed}/${shows.length}] SKIP ${show.slug}: ${err.message}`);
      continue;
    }
    // Alternate editorial lists for a show that already has a canonical page
    // ("... (Definitive)", "... Manga Canon"). They describe the same anime,
    // so they collide on the same AniList id while disagreeing wildly about
    // what counts as filler. The canonical page is the one to keep.
    if (ALTERNATE_LIST_SLUG.test(show.slug)) {
      console.log(`  [${processed}/${shows.length}] ${show.title}: alternate list, skipping`);
      continue;
    }

    const { filler } = parseShowPage(html);
    if (filler.length === 0) {
      console.log(`  [${processed}/${shows.length}] ${show.title}: no filler, skipping`);
      continue;
    }

    const episodeCount = countEpisodeRows(html);
    const anilistCacheFile = slugToCacheFile(ANILIST_CACHE_DIR, show.slug, 'json');
    const media = await resolveAnilistMedia(show.title, anilistCacheFile, episodeCount);
    if (!media) {
      console.log(`  [${processed}/${shows.length}] ${show.title}: no AniList match, skipping`);
      continue;
    }
    const anilistId = media.id;

    const { kept, dropped } = trimToEntry(filler, media.episodes);
    if (dropped > 0) {
      trimmed.push({ title: show.title, id: anilistId, dropped, entryEpisodes: media.episodes, pageEpisodes: episodeCount });
    }
    if (kept.length === 0) {
      console.log(
        `  [${processed}/${shows.length}] ${show.title}: all ${filler.length} filler ep(s) fall outside ` +
          `AniList ${anilistId} (${media.episodes} eps) -- franchise numbering, skipping`
      );
      continue;
    }

    const key = String(anilistId);
    if (key in result) {
      // Never silently overwrite: two pages claiming one id means a mis-
      // resolution, and the loser vanishes from the dataset entirely.
      collisions.push({ id: key, kept: seenBy[key], dropped: show.title });
      console.log(
        `  [${processed}/${shows.length}] ${show.title}: COLLISION on AniList ${anilistId} ` +
          `(already claimed by "${seenBy[key]}") -- keeping the first, dropping this`
      );
      continue;
    }

    result[key] = kept;
    seenBy[key] = show.title;
    console.log(
      `  [${processed}/${shows.length}] ${show.title} -> AniList ${anilistId}: ${kept.length} filler eps` +
        (dropped > 0 ? ` (dropped ${dropped} past ep ${media.episodes})` : '')
    );
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(result), 'utf8');
  console.log(`Wrote ${Object.keys(result).length} entries to ${OUTPUT_PATH}`);
  if (trimmed.length) {
    const total = trimmed.reduce((n, t) => n + t.dropped, 0);
    console.log(
      `\n${trimmed.length} franchise page(s), ${total} episode number(s) dropped as out of range:`
    );
    for (const t of trimmed.slice(0, 15)) {
      console.log(`  ${t.title}: dropped ${t.dropped} (entry has ${t.entryEpisodes} eps, page lists ${t.pageEpisodes})`);
    }
    if (trimmed.length > 15) console.log(`  ... and ${trimmed.length - 15} more`);
  }
  if (collisions.length) {
    console.log(`\n${collisions.length} AniList id collision(s) -- these need a look:`);
    for (const c of collisions) {
      console.log(`  id ${c.id}: kept "${c.kept}", dropped "${c.dropped}"`);
    }
  }
}

export { CACHE_DIR, SHOWS_CACHE_DIR, ANILIST_CACHE_DIR };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
