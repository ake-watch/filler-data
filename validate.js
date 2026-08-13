#!/usr/bin/env node
// Dev-only validation harness: fetches a small, curated set of shows known
// to carry both "filler" and "mixed_canon/filler" rows, resolves them to
// AniList IDs, and compares two interpretations of "filler episode" against
// the third-party dataset we're replacing -- pure "filler" rows only, vs.
// "filler" + "mixed_canon/filler" rows combined.
//
// This is a one-off research script, not part of the production pipeline.
// It respects the same 10s crawl-delay via scrape.js's fetchAfl().

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAfl,
  resolveAnilistId,
  parseShowPage,
  slugToCacheFile,
  SHOWS_CACHE_DIR,
  ANILIST_CACHE_DIR,
} from './scrape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALIDATION_SHOWS = [
  { slug: 'naruto', title: 'Naruto' },
  { slug: 'bleach', title: 'Bleach' },
  { slug: 'one-piece', title: 'One Piece' },
  { slug: 'naruto-shippuden', title: 'Naruto Shippuden' },
  { slug: 'fairy-tail', title: 'Fairy Tail' },
  { slug: 'dragon-ball', title: 'Dragon Ball' },
  { slug: 'inuyasha', title: 'Inuyasha' },
  { slug: 'detective-conan', title: 'Detective Conan' },
  { slug: 'fullmetal-alchemist', title: 'Fullmetal Alchemist' },
  { slug: 'fullmetal-alchemist-brotherhood', title: 'Fullmetal Alchemist: Brotherhood' },
  { slug: 'yuyu-hakusho', title: 'Yu Yu Hakusho' },
  { slug: 'boruto-naruto-next-generations', title: 'Boruto: Naruto Next Generations' },
];

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  const oldJsonPath = path.join(__dirname, '.cache', 'old-filler.json');
  const oldData = JSON.parse(await readFile(oldJsonPath, 'utf8'));

  const rows = [];
  for (const show of VALIDATION_SHOWS) {
    const showCacheFile = slugToCacheFile(SHOWS_CACHE_DIR, show.slug, 'html');
    const html = await fetchAfl(`/shows/${show.slug}`, showCacheFile);
    const { filler, mixed } = parseShowPage(html);
    const fillerPlusMixed = [...filler, ...mixed].sort((a, b) => a - b);

    const anilistCacheFile = slugToCacheFile(ANILIST_CACHE_DIR, show.slug, 'json');
    const anilistId = await resolveAnilistId(show.title, anilistCacheFile);

    const oldEntry = anilistId ? oldData[String(anilistId)] : undefined;

    let verdict = 'no-old-entry';
    if (oldEntry) {
      const pureMatches = arraysEqual(filler, oldEntry);
      const mixedMatches = arraysEqual(fillerPlusMixed, oldEntry);
      verdict = pureMatches ? 'PURE_FILLER_MATCHES' : mixedMatches ? 'MIXED_PLUS_FILLER_MATCHES' : 'NEITHER_MATCHES';
    }

    rows.push({
      slug: show.slug,
      anilistId,
      pureFillerCount: filler.length,
      mixedCount: mixed.length,
      oldEntryCount: oldEntry ? oldEntry.length : null,
      verdict,
    });
  }

  console.table(rows);

  const withOld = rows.filter((r) => r.oldEntryCount !== null);
  const pureMatchCount = withOld.filter((r) => r.verdict === 'PURE_FILLER_MATCHES').length;
  console.log(
    `\n${pureMatchCount}/${withOld.length} shows with an old-dataset entry matched exactly under the PURE-FILLER-ONLY interpretation.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
