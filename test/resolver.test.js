// Unit tests for AniList candidate selection.
//
// Every case here is a real mis-resolution observed against the live API, not
// an invented one. AniList's own ranking is title-similarity only, so it
// cannot separate a series from its sequel; these pin the tie-breaking rules
// that fix that without regressing the easy cases.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pickCandidate, countEpisodeRows, ALTERNATE_LIST_SLUG, trimToEntry } from '../scrape.js'

const media = (id, romaji, episodes, english = null) => ({
  id, episodes, title: { romaji, english }, startDate: { year: null }
})

describe('pickCandidate', () => {
  test('returns null with no candidates', () => {
    assert.equal(pickCandidate([], 12, 'Anything'), null)
  })

  test('an exact title match beats a better episode-count match', () => {
    // Observed: the Clannad page's row count equals After Story's episode
    // count, which stole the id and dropped Clannad from the dataset.
    const candidates = [
      media(4181, 'Clannad: After Story', 24),
      media(2167, 'Clannad', 23)
    ]
    assert.equal(pickCandidate(candidates, 24, 'Clannad').id, 2167)
  })

  test('episode count separates series from sequel when titles are near-identical', () => {
    // Observed: "Hunter x Hunter (2011)" resolved to the 1999 series.
    const candidates = [
      media(136, 'HUNTER×HUNTER', 62),
      media(11061, 'HUNTER×HUNTER (2011)', 148)
    ]
    assert.equal(pickCandidate(candidates, 148, 'Hunter × Hunter (2011)').id, 11061)
    assert.equal(pickCandidate(candidates, 92, 'Hunter × Hunter').id, 136)
  })

  test('normalises the multiplication sign so AFL and AniList titles compare equal', () => {
    const candidates = [media(11061, 'HUNTER×HUNTER (2011)', 148), media(136, 'HUNTER×HUNTER', 62)]
    assert.equal(pickCandidate(candidates, null, 'Hunter x Hunter (2011)').id, 11061)
  })

  test('falls back to the stripped title when the full one matches nothing', () => {
    // Observed: "Soul Hunter (Hoshin Engi)" -- the parenthetical is an alt
    // name, not a disambiguator, and only the stripped form matches.
    const candidates = [
      media(99727, 'Hakyuu Houshin Engi', 23, 'HAKYU HOSHIN ENGI'),
      media(1108, 'Soul Hunter', 26)
    ]
    assert.equal(pickCandidate(candidates, 26, 'Soul Hunter (Hoshin Engi)').id, 1108)
  })

  test('prefers the episode count when no title matches at all', () => {
    const candidates = [media(1, 'Something Else', 12), media(2, 'Another Thing', 26)]
    assert.equal(pickCandidate(candidates, 26, 'Unrelated Title').id, 2)
  })

  test('falls back to AniList ranking when nothing else discriminates', () => {
    const candidates = [media(1, 'A', 12), media(2, 'B', 13)]
    assert.equal(pickCandidate(candidates, null, 'Nope').id, 1)
  })

  test('an exact match among several is broken by episode count', () => {
    const candidates = [media(1, 'Same Name', 12), media(2, 'Same Name', 26)]
    assert.equal(pickCandidate(candidates, 26, 'Same Name').id, 2)
  })
})

describe('countEpisodeRows', () => {
  test('counts episode rows only, not the Quick List summary divs', () => {
    const html = `
      <div class="filler"><span class="Episodes">1-3</span></div>
      <tr class="manga_canon odd" id="eps-1"><td>a</td></tr>
      <tr class="filler even" id="eps-2"><td>b</td></tr>
      <tr class="mixed_canon/filler odd" id="eps-3"><td>c</td></tr>`
    assert.equal(countEpisodeRows(html), 3)
  })

  test('is zero for a page with no episode table', () => {
    assert.equal(countEpisodeRows('<html><body>nothing</body></html>'), 0)
  })
})

describe('trimToEntry', () => {
  test('drops episode numbers the AniList entry cannot contain', () => {
    // Observed: the Highschool DxD page numbers 1-48 across four 12-episode
    // seasons and marks 34-36 as filler. Keyed to any single season, none of
    // those episodes exist -- the incumbent dataset ships exactly this.
    assert.deepEqual(trimToEntry([34, 35, 36], 12), { kept: [], dropped: 3 })
  })

  test('keeps everything when the page and the entry agree', () => {
    assert.deepEqual(trimToEntry([2, 7, 18], 26), { kept: [2, 7, 18], dropped: 0 })
  })

  test('keeps the in-range prefix of a franchise page', () => {
    assert.deepEqual(trimToEntry([3, 9, 40, 55], 12), { kept: [3, 9], dropped: 2 })
  })

  test('is a no-op when the entry episode count is unknown', () => {
    // AniList reports null episodes for still-airing shows; trimming on a
    // guess would silently delete real filler.
    assert.deepEqual(trimToEntry([1, 2, 999], null), { kept: [1, 2, 999], dropped: 0 })
  })

  test('boundary: an episode equal to the entry length is kept', () => {
    assert.deepEqual(trimToEntry([12], 12), { kept: [12], dropped: 0 })
  })
})

describe('ALTERNATE_LIST_SLUG', () => {
  test('matches the alternate editorial lists', () => {
    assert.ok(ALTERNATE_LIST_SLUG.test('boruto-naruto-next-generations-definitive-filler-list'))
    assert.ok(ALTERNATE_LIST_SLUG.test('boruto-naruto-next-generations-manga-canon'))
  })

  test('does not match canonical show pages', () => {
    for (const slug of ['boruto-naruto-next-generations', 'naruto', 'hunter-x-hunter-1999', 'clannad']) {
      assert.ok(!ALTERNATE_LIST_SLUG.test(slug), `${slug} must not be treated as an alternate list`)
    }
  })
})
