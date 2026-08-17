#!/usr/bin/env node
// Merge the films pass into the series dataset.
//
// The two passes key different things: scrape.js writes one id per show with
// its filler episode numbers, films.js writes one id per non-canon film with
// [1]. They are disjoint by construction, and this refuses to run if they ever
// stop being -- an id claimed by both means one of the two mis-resolved, and
// silently letting one win would either lose a show's episode list or mark a
// series episode 1 that nobody said was filler.
//
// Order matters: scrape.js rewrites filler.json from scratch, so run this
// after it, not before. Re-running is a no-op.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERIES = path.join(__dirname, 'filler.json');
const FILMS = path.join(__dirname, 'films.json');

if (!existsSync(FILMS)) {
  console.error(`${FILMS} does not exist -- run films.js first.`);
  process.exit(1);
}

const series = JSON.parse(readFileSync(SERIES, 'utf8'));
const films = JSON.parse(readFileSync(FILMS, 'utf8'));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clashes = Object.keys(films).filter((k) => k in series && !same(series[k], films[k]));
if (clashes.length) {
  console.error(`${clashes.length} id(s) claimed by both passes with different values:`);
  for (const k of clashes) console.error(`  ${k}: series ${JSON.stringify(series[k])}, film ${JSON.stringify(films[k])}`);
  console.error('Nothing written. Resolve these before merging.');
  process.exit(1);
}

const added = Object.keys(films).filter((k) => !(k in series));
const merged = { ...series, ...films };
writeFileSync(SERIES, JSON.stringify(merged), 'utf8');
console.log(`Merged ${Object.keys(films).length} film id(s), ${added.length} new -> ${SERIES}`);
console.log(`${SERIES} now has ${Object.keys(merged).length} id(s).`);
