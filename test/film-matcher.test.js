// Scoring harness for the film matcher, graded against the incumbent dataset.
//
// The dataset we replace already knows the right AniList id for every film we
// currently fail to resolve, so this is not a judgement call: each target below
// is the incumbent's own answer. A relaxation that resolves a target to a
// DIFFERENT id is a failure, not a partial success -- that is the direction
// that writes [1] onto an unrelated work and makes a consumer skip real
// content. Omission stays benign.
//
// Fixtures are real AniList responses captured against the live API, so these
// grade the matcher against what the service actually returns, and run offline.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pickFilmCandidate, filmSearchTerms } from '../scrape.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(path.join(root, 'test', 'fixtures', 'film-candidates.json'), 'utf8'))
const { rows, candidates } = fixture

// The 12 film-shaped ids the incumbent carries and our scrape did not reach,
// each paired with the animefillerlist row that must produce it. Every pairing
// was confirmed by reading the AniList entry's own titles, not inferred from
// the search ranking.
const TARGETS = {
  442: 'Ninja Clash In the Land of Snow',
  466: 'Defeat Him! The Pirate Ganzack!',
  468: 'Innocence',
  761: 'Find the Crimson Four-Leaf Clover!',
  894: 'Dead Zone',
  908: 'Chibi Party',
  1894: 'Pyramid of Light',
  2889: 'The DiamondDust Rebellion',
  13271: 'Phantom Rouge',
  17535: 'The First Morning',
  106223: 'The All Magic Knights Thanksgiving',
  166456: null, // no animefillerlist row produces it -- see the report
}

// Resolution order under test: try each search term, take the first term whose
// candidate list yields an unambiguous pick. Mirrors films.js exactly.
function resolve(row) {
  for (const term of filmSearchTerms(row.franchise, row.title)) {
    const media = candidates[term]
    if (!media || media.length === 0) continue
    const chosen = pickFilmCandidate(media, row.searchKey, row.franchise)
    if (chosen) return { id: chosen.id, term }
  }
  return { id: null, term: null }
}

describe('film matcher scoring harness', () => {
  test('every row resolves to at most one id and never to a non-film format', () => {
    for (const row of rows) {
      const { id, term } = resolve(row)
      if (id === null) continue
      const m = candidates[term].find((x) => x.id === id)
      assert.ok(['MOVIE', 'OVA', 'SPECIAL', 'ONA'].includes(m.format), `${row.searchKey} resolved to ${m.format}`)
    }
  })

  test('the 12 incumbent-only film ids resolve to the incumbent id, or not at all', () => {
    const byTitle = new Map(rows.map((r) => [r.title, r]))
    const report = []
    let wrong = 0
    let resolved = 0
    for (const [id, title] of Object.entries(TARGETS)) {
      if (title === null) { report.push(`${id}: NO SOURCE ROW`); continue }
      const row = byTitle.get(title)
      assert.ok(row, `no cached row titled "${title}"`)
      const got = resolve(row).id
      if (got === Number(id)) { resolved++; report.push(`${id}: resolved`) }
      else if (got === null) report.push(`${id}: omitted`)
      else { wrong++; report.push(`${id}: WRONG-ID ${got}`) }
    }
    console.log('    ' + report.join('\n    '))
    assert.equal(wrong, 0, 'a target resolved to an id the incumbent does not have')
    assert.equal(resolved, 11, `expected 11 of 12 targets resolved, got ${resolved}`)
  })

  test('no currently-resolved film changes id', () => {
    const baseline = JSON.parse(readFileSync(path.join(root, 'test', 'fixtures', 'film-baseline.json'), 'utf8'))
    for (const [title, id] of Object.entries(baseline)) {
      const row = rows.find((r) => r.title === title)
      assert.ok(row, `baseline row "${title}" vanished`)
      assert.equal(resolve(row).id, id, `"${title}" moved off its baseline id`)
    }
  })
})
