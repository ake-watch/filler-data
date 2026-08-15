#!/usr/bin/env node
// Films / OVAs / specials pass.
//
// animefillerlist puts a franchise's films on collection pages ("One Piece
// Films") where each ROW is a separate work, not episode N of a series. The
// dataset we replace stores each as its own AniList id with the value [1] --
// the whole film is filler.
//
// This pass deliberately does NOT write filler.json. It writes films.json and
// a report, because it introduces a second fuzzy-matching surface over short
// ambiguous titles, and every defect found in this project so far came from
// exactly that. Merge only once the report shows it reproducing the incumbent's
// film entries. Omitting a film is harmless -- no key means nothing marked; a
// wrong match writes [1] onto an unrelated work and there is no episode count
// to catch it.
//
// Reads only cached show pages, so it costs no animefillerlist requests.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCollectionPage, filmSearchKey, pickFilmCandidate,
  slugToCacheFile, ANILIST_CACHE_DIR,
} from './scrape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWS = path.join(__dirname, '.cache', 'shows');
const ORACLE = path.join(__dirname, '.cache', 'old-filler.json');
const OUT = path.join(__dirname, 'films.json');

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const ANILIST_DELAY_MS = 1_500;
const USER_AGENT =
  'filler-data-scraper/1.0 (+https://github.com/ake-app/filler-data; ' +
  'non-commercial dataset build, respects robots.txt Crawl-delay)';

const QUERY = `query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: ANIME) {
      id
      format
      episodes
      title { romaji english }
    }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;

async function search(term) {
  const wait = ANILIST_DELAY_MS - (Date.now() - lastAt);
  if (wait > 0) await sleep(wait);
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ query: QUERY, variables: { search: term } }),
  });
  lastAt = Date.now();
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') || '5', 10);
    await sleep((retry + 1) * 1000);
    return search(term);
  }
  if (!res.ok) return { error: res.status, media: [] };
  const json = await res.json();
  return { error: null, media: json?.data?.Page?.media ?? [] };
}

async function resolveFilm(searchKey, cacheFile) {
  if (existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    return { id: c.id, cached: true, error: c.error ?? null };
  }
  const { error, media } = await search(searchKey);
  if (error) return { id: null, cached: false, error };
  const chosen = pickFilmCandidate(media, searchKey);
  writeFileSync(
    cacheFile,
    JSON.stringify({ id: chosen?.id ?? null, searchKey, format: chosen?.format ?? null, candidates: media.length }),
    'utf8'
  );
  return { id: chosen?.id ?? null, cached: false, error: null };
}

const films = [];
for (const f of readdirSync(SHOWS).filter((x) => x.endsWith('.html'))) {
  const parsed = parseCollectionPage(readFileSync(path.join(SHOWS, f), 'utf8'));
  if (!parsed) continue;
  for (const row of parsed.rows) {
    if (!row.filler) continue;
    films.push({ franchise: parsed.franchise, ...row, searchKey: filmSearchKey(parsed.franchise, row.title) });
  }
}

console.log(`${films.length} filler film(s)/OVA(s) across the collection pages.`);

const result = {};
let resolved = 0;
let unresolved = 0;
let apiDown = false;

for (const film of films) {
  const cacheFile = slugToCacheFile(ANILIST_CACHE_DIR, `film-${film.filmSlug}`, 'json');
  const { id, error } = await resolveFilm(film.searchKey, cacheFile);
  if (error) {
    apiDown = true;
    console.log(`  AniList unavailable (HTTP ${error}) -- stopping`);
    break;
  }
  if (id) {
    result[String(id)] = [1];
    resolved += 1;
  } else {
    unresolved += 1;
    console.log(`  unresolved: ${film.searchKey}`);
  }
}

if (apiDown) {
  console.log('\nNothing written. Re-run when the AniList API is available.');
  process.exit(2);
}

writeFileSync(OUT, JSON.stringify(result), 'utf8');
console.log(`\nresolved ${resolved}, omitted ${unresolved} -> ${OUT}`);

// Validation: the dataset we replace already carries film entries. Reproducing
// them is the evidence that this matcher works; anything it invents that the
// incumbent lacks needs a manual look before merging.
if (existsSync(ORACLE)) {
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8'));
  const series = existsSync(path.join(__dirname, 'filler.json'))
    ? JSON.parse(readFileSync(path.join(__dirname, 'filler.json'), 'utf8'))
    : {};
  const theirFilmIds = Object.keys(oracle).filter((k) => !(k in series));
  const hit = theirFilmIds.filter((k) => k in result);
  const miss = theirFilmIds.filter((k) => !(k in result));
  const extra = Object.keys(result).filter((k) => !(k in oracle));
  console.log(`\n=== validation against the incumbent ===`);
  console.log(`  its film-shaped ids:        ${theirFilmIds.length}`);
  console.log(`  reproduced:                 ${hit.length}`);
  console.log(`  missed:                     ${miss.length}  ${miss.join(' ')}`);
  console.log(`  ids it does not have:       ${extra.length}  ${extra.join(' ')}`);
  console.log(`\n  MERGE ONLY IF "missed" is small and every "ids it does not have" checks out.`);
}
