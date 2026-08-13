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
  filler.sort((a, b) => a - b);
  mixed.sort((a, b) => a - b);
  return { filler, mixed };
}

// --- AniList resolution ---------------------------------------------------

const ANILIST_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    title { romaji english }
  }
}`;

let lastAnilistFetchAt = 0;
export async function resolveAnilistId(title, cacheFile) {
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    return cached.id;
  }
  const wait = ANILIST_DELAY_MS - (Date.now() - lastAnilistFetchAt);
  if (wait > 0) await sleep(wait);
  // Strip parenthetical alt-titles ("A Certain Magical Index (Toaru...)")
  // which usually hurts AniList's fuzzy search more than it helps.
  const cleanTitle = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: cleanTitle } }),
  });
  lastAnilistFetchAt = Date.now();
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    await sleep((retryAfter + 1) * 1000);
    return resolveAnilistId(title, cacheFile);
  }
  if (!res.ok) {
    await writeFile(cacheFile, JSON.stringify({ id: null, error: res.status }), 'utf8');
    return null;
  }
  const json = await res.json();
  const id = json?.data?.Media?.id ?? null;
  await writeFile(cacheFile, JSON.stringify({ id, title }), 'utf8');
  return id;
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
    const { filler } = parseShowPage(html);
    if (filler.length === 0) {
      console.log(`  [${processed}/${shows.length}] ${show.title}: no filler, skipping`);
      continue;
    }

    const anilistCacheFile = slugToCacheFile(ANILIST_CACHE_DIR, show.slug, 'json');
    const anilistId = await resolveAnilistId(show.title, anilistCacheFile);
    if (!anilistId) {
      console.log(`  [${processed}/${shows.length}] ${show.title}: no AniList match, skipping`);
      continue;
    }

    result[String(anilistId)] = filler;
    console.log(
      `  [${processed}/${shows.length}] ${show.title} -> AniList ${anilistId}: ${filler.length} filler eps`
    );
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(result), 'utf8');
  console.log(`Wrote ${Object.keys(result).length} entries to ${OUTPUT_PATH}`);
}

export { CACHE_DIR, SHOWS_CACHE_DIR, ANILIST_CACHE_DIR };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
