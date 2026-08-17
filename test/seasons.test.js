// Unit tests for the curated per-season episode map.
//
// animefillerlist numbers a franchise continuously across seasons while an
// AniList id addresses one season, so a franchise page's filler numbers have
// to be split back out per season before they mean anything. The map is
// curated by hand, never inferred: every franchise below is admitted only
// because its seasons' AniList episode counts sum to exactly the number of
// episode rows on the source page, which pins the boundaries with no guessing.
//
// Every guard here fails closed. A franchise that cannot be mapped with
// certainty yields nothing, because marking a canon episode as filler makes a
// consumer silently skip it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { FRANCHISE_SEASONS, mapFranchiseFiller } from '../seasons.js'

describe('table integrity', () => {
  test('every franchise sums to its page episode count', () => {
    const bad = []
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      const total = e.seasons.reduce((n, s) => n + s.episodes, 0)
      if (total !== e.pageEpisodes) bad.push(`${slug}: seasons sum to ${total}, page has ${e.pageEpisodes}`)
    }
    assert.deepEqual(bad, [], 'a franchise whose seasons do not sum to the page length has unpinned boundaries')
  })

  test('every season has a positive id and episode count', () => {
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      for (const s of e.seasons) {
        assert.ok(Number.isInteger(s.id) && s.id > 0, `${slug}: bad id ${s.id}`)
        assert.ok(Number.isInteger(s.episodes) && s.episodes > 0, `${slug}: bad episode count ${s.episodes}`)
      }
    }
  })

  test('no season id appears twice within a franchise', () => {
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      const ids = e.seasons.map(s => s.id)
      assert.equal(new Set(ids).size, ids.length, `${slug}: duplicate season id`)
    }
  })

  test('a held franchise records why it is held', () => {
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      if (e.hold) assert.equal(typeof e.hold, 'string', `${slug}: hold must carry a reason`)
    }
  })
})

describe('mapping', () => {
  test('splits Gantz 22-26 onto the second season', () => {
    const m = mapFranchiseFiller('gantz', [22, 23, 24, 25, 26], 26)
    assert.deepEqual([...m], [[395, [9, 10, 11, 12, 13]]])
  })

  test('maps the whole four-episode Nanatsu no Taizai special onto its own id', () => {
    const m = mapFranchiseFiller('nanatsu-no-taizai', [25, 26, 27, 28], 100)
    assert.deepEqual([...m], [[21385, [1, 2, 3, 4]]])
  })

  test('splits My Hero Academia across three season ids', () => {
    const m = mapFranchiseFiller('my-hero-academia', [39, 58, 64, 104], 170)
    assert.deepEqual([...m], [[100166, [1, 20]], [104276, [1]], [117193, [16]]])
  })

  test('an unknown slug maps to nothing', () => {
    assert.equal(mapFranchiseFiller('naruto', [1], 220), null)
  })

  test('a page whose episode row count no longer matches the table maps to nothing', () => {
    assert.equal(mapFranchiseFiller('gantz', [22], 27), null)
  })

  test('a held franchise maps to nothing', () => {
    assert.equal(mapFranchiseFiller('high-school-dxd', [34, 35, 36], 49), null)
  })

  test('a table whose seasons do not sum to the page length maps to nothing', () => {
    // Not reachable through the shipped table, which is guarded above, but the
    // check is what keeps a future bad edit from silently shifting boundaries.
    const bad = { thing: { pageEpisodes: 26, seasons: [{ id: 1, episodes: 13 }, { id: 2, episodes: 12 }] } }
    assert.equal(mapFranchiseFiller('thing', [1], 26, bad), null)
  })

  test('an episode number past the end of the franchise maps to nothing', () => {
    assert.equal(mapFranchiseFiller('gantz', [27], 26), null)
  })

  test('a non-positive episode number maps to nothing', () => {
    assert.equal(mapFranchiseFiller('gantz', [0], 26), null)
  })

  test('every mapped episode lands inside its season', () => {
    for (const [slug, e] of Object.entries(FRANCHISE_SEASONS)) {
      if (e.hold) continue
      const all = Array.from({ length: e.pageEpisodes }, (_, i) => i + 1)
      const m = mapFranchiseFiller(slug, all, e.pageEpisodes)
      assert.ok(m, `${slug}: a complete run must map`)
      const byId = new Map(e.seasons.map(s => [s.id, s.episodes]))
      let count = 0
      for (const [id, eps] of m) {
        count += eps.length
        for (const ep of eps) {
          assert.ok(ep >= 1 && ep <= byId.get(id), `${slug}: ${ep} outside season ${id}`)
        }
      }
      assert.equal(count, e.pageEpisodes, `${slug}: mapping lost or duplicated episodes`)
    }
  })
})
