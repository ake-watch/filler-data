// Tests for the films/OVAs/specials pass.
//
// These pages are structurally identical to a normal show page -- same table,
// same row classes -- but semantically different: each row is a separate work
// with its own AniList entry, not episode N of one series. The dataset we
// replace stores each as its own id with value [1].
//
// Fixtures are real cached pages, so these assert against markup the site
// actually serves rather than a hand-written approximation.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  collectionFranchise, parseCollectionPage, filmSearchKey,
  pickFilmCandidate, FILM_FORMATS, COLLECTION_H1
} from '../scrape.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOWS = path.join(root, '.cache', 'shows')
const page = f => readFileSync(path.join(SHOWS, f), 'utf8')
const media = (id, romaji, format, english = null) => ({ id, format, title: { romaji, english } })

describe('collection page detection', () => {
  test('recognises the collection suffixes', () => {
    for (const n of ['One Piece Films', 'Naruto OVAs', 'Dragon Ball Specials', 'My Hero Academia Movies', 'Attack on Titan OADs']) {
      assert.ok(COLLECTION_H1.test(n), `${n} should be a collection`)
    }
  })

  test('does not treat a normal show as a collection', () => {
    for (const n of ['Naruto', 'Bleach', 'Clannad', 'Hunter x Hunter (2011)']) {
      assert.ok(!COLLECTION_H1.test(n), `${n} must not be a collection`)
    }
  })

  test('a normal cached show page yields no franchise', { skip: !existsSync(path.join(SHOWS, 'naruto.html')) }, () => {
    assert.equal(collectionFranchise(page('naruto.html')), null)
    assert.equal(parseCollectionPage(page('naruto.html')), null)
  })

  test('strips the collection word to get the franchise', { skip: !existsSync(path.join(SHOWS, 'one-piece-movies.html')) }, () => {
    // H1 is "One Piece Films Filler List"
    assert.equal(collectionFranchise(page('one-piece-movies.html')), 'One Piece')
  })
})

describe('parseCollectionPage', () => {
  test('extracts per-film rows with slug, title and filler flag', { skip: !existsSync(path.join(SHOWS, 'one-piece-movies.html')) }, () => {
    const parsed = parseCollectionPage(page('one-piece-movies.html'))
    assert.ok(parsed && parsed.rows.length > 0)
    const first = parsed.rows[0]
    assert.equal(first.episode, 1)
    assert.equal(first.title, 'One Piece: The Movie')
    assert.equal(first.filler, true)
    assert.ok(first.filmSlug.length > 0)
    // every row must carry a distinct film slug -- if they collapse, the pass
    // would write one film's verdict onto all of them
    const slugs = new Set(parsed.rows.map(r => r.filmSlug))
    assert.ok(slugs.size > 1, 'film slugs must differ per row')
  })

  test('decodes percent-escapes in film slugs', { skip: !existsSync(path.join(SHOWS, 'one-piece-movies.html')) }, () => {
    const parsed = parseCollectionPage(page('one-piece-movies.html'))
    assert.ok(!parsed.rows.some(r => /%[0-9A-Fa-f]{2}/.test(r.filmSlug)), 'slugs should be decoded')
  })

  test('row count matches the filler rows the page actually has', { skip: !existsSync(SHOWS) }, () => {
    let pagesChecked = 0
    for (const f of readdirSync(SHOWS).filter(x => x.endsWith('.html'))) {
      const html = page(f)
      const parsed = parseCollectionPage(html)
      if (!parsed) continue
      const expected = (html.match(/<tr class="filler[^"]*" id="eps-\d+">/g) || []).length
      const got = parsed.rows.filter(r => r.filler).length
      assert.equal(got, expected, `${f}: parsed ${got} filler rows, page has ${expected}`)
      pagesChecked++
    }
    assert.ok(pagesChecked > 0, 'no collection pages in the corpus')
    console.log(`    verified ${pagesChecked} collection page(s)`)
  })
})

describe('filmSearchKey', () => {
  test('prefixes the franchise when the title lacks it', () => {
    assert.equal(filmSearchKey('One Piece', 'Clockwork Island Adventure'), 'One Piece Clockwork Island Adventure')
  })

  test('leaves an already-qualified title alone', () => {
    assert.equal(filmSearchKey('One Piece', 'One Piece: The Movie'), 'One Piece: The Movie')
  })

  test('matches the franchise regardless of punctuation', () => {
    assert.equal(filmSearchKey('Yu-Gi-Oh!', 'Yu Gi Oh The Movie'), 'Yu Gi Oh The Movie')
  })
})

describe('pickFilmCandidate', () => {
  test('never returns a TV series', () => {
    const candidates = [media(223, 'Dragon Ball', 'TV'), media(502, 'Dragon Ball: Curse of the Blood Rubies', 'MOVIE')]
    assert.equal(pickFilmCandidate(candidates, 'Dragon Ball Curse of the Blood Rubies').id, 502)
    assert.equal(pickFilmCandidate([media(223, 'Dragon Ball', 'TV')], 'Dragon Ball'), null)
  })

  test('omits rather than guessing when nothing matches exactly', () => {
    const candidates = [media(1, 'Something Unrelated', 'MOVIE')]
    assert.equal(pickFilmCandidate(candidates, 'One Piece Clockwork Island Adventure'), null)
  })

  test('omits when two candidates match equally well', () => {
    const candidates = [media(1, 'Same Film', 'MOVIE'), media(2, 'Same Film', 'OVA')]
    assert.equal(pickFilmCandidate(candidates, 'Same Film'), null)
  })

  test('accepts an exact match on the english title', () => {
    const candidates = [media(459, 'One Piece: The Movie', 'MOVIE', 'ONE PIECE: The Movie')]
    assert.equal(pickFilmCandidate(candidates, 'One Piece: The Movie').id, 459)
  })

  test('the permitted formats are exactly the non-series ones', () => {
    assert.deepEqual([...FILM_FORMATS].sort(), ['MOVIE', 'ONA', 'OVA', 'SPECIAL'])
  })
})
