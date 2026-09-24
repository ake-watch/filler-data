// Hermetic test suite for the generated dataset.
//
// No network -- episode counts come from .cache/anilist, recorded by the
// scraper at resolution time. Asserts:
//   1. SCHEMA     -- the output matches the documented contract
//   2. INVARIANTS -- properties that must hold for any correct dataset
//   3. PARITY     -- differential test against the dataset we replace
//
// Parity is NOT plain equality. The incumbent marks episodes that do not exist
// in the AniList entry it keys them to, because animefillerlist numbers
// franchises continuously across seasons while an id addresses one season. We
// drop those, so we differ from it on purpose. The gate is therefore:
//
//   * no entry may mark an episode its AniList entry does not have;
//   * we may never mark an episode the incumbent does not (the dangerous
//     direction -- a consumer with auto-skip would drop real episodes);
//   * every remaining difference must be an out-of-range drop, nothing else;
//   * and we must eventually cover every show it covers.
//
// Only the last currently fails, and only for the films/OVAs pages.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { FRANCHISE_SEASONS, mapFranchiseFiller } from '../seasons.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATASET = path.join(root, 'filler.json')
const ORACLE = path.join(root, '.cache', 'old-filler.json')

const read = p => JSON.parse(readFileSync(p, 'utf8'))
const dataset = read(DATASET)

describe('schema', () => {
  test('top level is a plain object', () => {
    assert.equal(typeof dataset, 'object')
    assert.ok(dataset !== null)
    assert.ok(!Array.isArray(dataset))
  })

  test('every key is a positive integer AniList id', () => {
    for (const k of Object.keys(dataset)) {
      assert.match(k, /^[1-9]\d*$/, `key ${JSON.stringify(k)} is not a positive integer string`)
    }
  })

  test('every value is a non-empty array of positive integers', () => {
    for (const [k, v] of Object.entries(dataset)) {
      assert.ok(Array.isArray(v), `id ${k}: value is not an array`)
      assert.ok(v.length > 0, `id ${k}: empty array -- omit the show instead`)
      for (const n of v) {
        assert.equal(typeof n, 'number', `id ${k}: episode ${JSON.stringify(n)} is not a number`)
        assert.ok(Number.isInteger(n), `id ${k}: episode ${n} is not an integer`)
        assert.ok(n > 0, `id ${k}: episode ${n} is not 1-indexed`)
      }
    }
  })
})

describe('invariants', () => {
  test('episode lists are strictly ascending (sorted and deduplicated)', () => {
    for (const [k, v] of Object.entries(dataset)) {
      for (let i = 1; i < v.length; i++) {
        assert.ok(v[i] > v[i - 1], `id ${k}: not strictly ascending at index ${i} (${v[i - 1]} then ${v[i]})`)
      }
    }
  })

  test('serialisation is canonical -- re-normalising changes nothing', () => {
    // Guards against a future scraper emitting unsorted or duplicated output
    // that happens to round-trip through JSON unnoticed.
    const normalised = Object.fromEntries(
      Object.entries(dataset).map(([k, v]) => [k, [...new Set(v)].sort((a, b) => a - b)])
    )
    assert.deepEqual(dataset, normalised)
  })

  test('no duplicate ids collapse (object keys are unique by construction)', () => {
    const raw = readFileSync(DATASET, 'utf8')
    const keyCount = (raw.match(/"\d+"\s*:/g) || []).length
    assert.equal(keyCount, Object.keys(dataset).length,
      'a duplicate key was silently dropped during parse')
  })
})

describe('parity against the incumbent dataset (release gate)', () => {
  const haveOracle = existsSync(ORACLE)
  const oracle = haveOracle ? read(ORACLE) : {}
  const norm = v => [...new Set(v)].sort((a, b) => a - b)
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

  // AniList episode counts, recorded by the scraper at resolution time so this
  // stays hermetic -- no network, and no dependence on AniList staying up.
  const episodeCounts = new Map()
  const ANILIST = path.join(root, '.cache', 'anilist')
  if (existsSync(ANILIST)) {
    for (const f of readdirSync(ANILIST)) {
      try {
        const c = read(path.join(ANILIST, f))
        if (c.id && c.matchedEpisodes) episodeCounts.set(String(c.id), c.matchedEpisodes)
      } catch { /* a malformed cache entry must not fail the suite */ }
    }
  }

  test('oracle is present', { skip: haveOracle ? false : 'no .cache/old-filler.json' }, () => {
    assert.ok(Object.keys(oracle).length > 0)
  })

  // Shows the incumbent covers and we do not. Absence is benign -- no key means
  // nothing is marked, so a consumer's skip feature simply does nothing -- but
  // it is not open-ended: nothing may join this list without a reason, and the
  // list may only shrink. Four reasons, and no others:
  //
  //   no filler in that season -- seasons.js now splits the franchise page per
  //   season, and the incumbent's key is a season that holds no filler once the
  //   continuous numbers are resolved. The filler is in this dataset, under the
  //   season ids that actually contain it.
  //
  //   boundaries unpinned -- the franchise's AniList season episode counts do
  //   not sum to the page's episode row count, so no boundary can be placed
  //   without guessing, and guessing here makes a consumer skip canon.
  //
  //   held -- mappable, but the mapping contradicts the incumbent on an id it
  //   already claims, which registers as an over-mark in the differential
  //   audit. Needs human sign-off, not an agent's judgement. See seasons.js.
  //
  //   different id -- animefillerlist's page does resolve, just not to the id
  //   the incumbent chose, and ours is the better fit.
  //
  //   no source row -- nothing on animefillerlist produces the id at all, so
  //   there is nothing to resolve from and no amount of matcher work reaches it.
  const KNOWN_UNCOVERED = {
    384: 'no filler in that season (Gantz; eps 22-26 are on 395, GANTZ 2)',
    6033: 'boundaries unpinned (Dragon Ball Z Kai; 97+69 seasons vs 167 page rows)',
    14829: 'boundaries unpinned (Prisma Illya; 10+10+10+12 seasons vs 43 page rows)',
    20776: 'different id (Ghost in the Shell: Arise; we key 21056, the 10-episode entry the page matches)',
    20789: 'no filler in that season (Nanatsu no Taizai; eps 25-28 are on 21385, Seisen no Shirushi)',
    21459: 'no filler in that season (My Hero Academia; eps 39/58/64/104 are on 100166, 104276, 117193)',
    166456: 'no source row (Celestial Bonds)',
  }

  // Where we are right and the incumbent is not, signed off by the user on 2026-08-18. Exact values
  // only: any other marks on these ids, or a disagreement on any other id, still fails.
  const SANCTIONED_CORRECTIONS = {
    20745: { ours: [10, 11, 12], reason: 'High School DxD BorN: page eps 34-36 are BorN 10-12; the incumbent keys franchise numbers to a 12-episode entry' },
  }
  const sanctioned = k => k in SANCTIONED_CORRECTIONS && eq(norm(dataset[k]), SANCTIONED_CORRECTIONS[k].ours)

  test('covers every show the incumbent covers, bar the documented residue', { skip: !haveOracle }, () => {
    const missing = Object.keys(oracle).filter(k => !(k in dataset))
    const undocumented = missing.filter(k => !(k in KNOWN_UNCOVERED))
    assert.deepEqual(undocumented, [],
      `${undocumented.length} show(s) in the incumbent are absent here for no recorded reason -- coverage regression`)
    const closed = Object.keys(KNOWN_UNCOVERED).filter(k => k in dataset)
    assert.deepEqual(closed, [],
      `now covered, drop from KNOWN_UNCOVERED: ${closed.join(' ')}`)
  })

  test('every disagreement with the incumbent is explained by out-of-range trimming', { skip: !haveOracle }, () => {
    // We deliberately diverge from the incumbent in exactly one way: it marks
    // episodes that do not exist in the AniList entry it keys them to (its
    // Highschool DxD entry is [34,35,36] on a 12-episode season), because
    // animefillerlist numbers franchises continuously. Those marks can never
    // match, so we drop them.
    //
    // This test does NOT permit arbitrary divergence: any disagreement that
    // is not an out-of-range drop -- especially an episode we mark and it
    // does not -- is a failure.
    const unexplained = []
    for (const k of Object.keys(oracle)) {
      if (!(k in dataset) || sanctioned(k)) continue
      const a = norm(oracle[k])
      const b = norm(dataset[k])
      if (a.length === b.length && a.every((x, i) => x === b[i])) continue

      const ours = new Set(b)
      const theirs = new Set(a)
      const weMarkExtra = b.filter(n => !theirs.has(n))
      const theyMarkExtra = a.filter(n => !ours.has(n))
      const entryEpisodes = episodeCounts.get(k)

      if (weMarkExtra.length > 0) {
        unexplained.push(`id ${k}: we mark ${weMarkExtra.join(',')} and the incumbent does not`)
        continue
      }
      if (!entryEpisodes) {
        unexplained.push(`id ${k}: differs but the entry's episode count is unknown`)
        continue
      }
      const inRange = theyMarkExtra.filter(n => n <= entryEpisodes)
      if (inRange.length > 0) {
        unexplained.push(`id ${k}: incumbent marks ${inRange.join(',')} which are within the entry's ${entryEpisodes} episodes`)
      }
    }
    assert.deepEqual(unexplained, [],
      `${unexplained.length} disagreement(s) not accounted for by out-of-range trimming`)
  })

  test('every mappable franchise is actually in the dataset, per season', { skip: !haveOracle }, () => {
    // The incumbent keys a franchise page's continuous numbers to its first
    // season, so its own entry is the input the map is supposed to split. Round
    // it back through the map and require the result to be present verbatim --
    // this is what fails if the scraper stops applying the map at all.
    const gaps = []
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      if (e.hold) continue
      const root = String(e.seasons[0].id)
      if (!(root in oracle)) continue
      const mapped = mapFranchiseFiller(slug, norm(oracle[root]), e.pageEpisodes)
      assert.ok(mapped, `${slug}: the incumbent's numbers no longer map`)
      for (const [id, eps] of mapped) {
        const have = dataset[String(id)]
        if (!have) { gaps.push(`${slug}: id ${id} missing from the dataset`); continue }
        if (!eq(norm(have), eps)) gaps.push(`${slug}: id ${id} is ${have.join(',')}, expected ${eps.join(',')}`)
      }
    }
    assert.deepEqual(gaps, [], `${gaps.length} franchise season(s) not carried into the dataset`)
  })

  test('no season-mapped entry marks an episode past that season', () => {
    // The franchise map writes ids the scraper never resolved, so .cache/anilist
    // has no episode count for them and the check below cannot see them.
    const offenders = []
    for (const e of Object.values(FRANCHISE_SEASONS)) {
      for (const s of e.seasons) {
        const marks = dataset[String(s.id)]
        if (!marks) continue
        const over = marks.filter(n => n < 1 || n > s.episodes)
        if (over.length) offenders.push(`id ${s.id}: season has ${s.episodes} eps, marks ${over.join(',')}`)
      }
    }
    assert.deepEqual(offenders, [], `${offenders.length} season-mapped entry/entries out of range`)
  })

  test('no entry marks an episode its AniList entry does not have', () => {
    // The bug this dataset exists to not have. The incumbent has it on 28 of
    // its 122 entries; Pokemon is keyed to an 8-episode entry while marking
    // episodes up to 1138.
    const offenders = []
    for (const [k, v] of Object.entries(dataset)) {
      const entryEpisodes = episodeCounts.get(k)
      if (!entryEpisodes) continue
      const over = v.filter(n => n > entryEpisodes)
      if (over.length) offenders.push(`id ${k}: entry has ${entryEpisodes} eps, marks ${over.slice(0, 5).join(',')}`)
    }
    assert.deepEqual(offenders, [], `${offenders.length} entry/entries mark non-existent episodes`)
  })

  test('never marks an episode filler that the incumbent does not', { skip: !haveOracle }, () => {
    // The only dangerous direction: a consumer with auto-skip enabled would
    // silently drop real episodes. Under-marking is benign by comparison.
    const overMarks = []
    for (const k of Object.keys(oracle)) {
      if (!(k in dataset) || sanctioned(k)) continue
      const a = new Set(norm(oracle[k]))
      for (const ep of norm(dataset[k])) {
        if (!a.has(ep)) overMarks.push(`${k}:${ep}`)
      }
    }
    assert.deepEqual(overMarks, [],
      `${overMarks.length} episode(s) marked filler here but not by the incumbent`)
  })
})
