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
  collectionFranchise, parseCollectionPage, filmSearchKey, filmSearchTerms,
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

describe('pickFilmCandidate, relaxed rung', () => {
  const syn = (id, romaji, format, english, synonyms = []) =>
    ({ id, format, title: { romaji, english }, synonyms })

  test('a qualifier AniList inserts does not break the match', () => {
    // Observed: every unresolved film failed this way. AniList writes
    // "<series> the Movie: <title>", animefillerlist writes "<series> <title>".
    const c = [syn(2889, 'BLEACH: The DiamondDust Rebellion', 'MOVIE', 'Bleach the Movie: The DiamondDust Rebellion')]
    assert.equal(pickFilmCandidate(c, 'Bleach The DiamondDust Rebellion', 'Bleach').id, 2889)
  })

  test('matches on a synonym when romaji and english both differ', () => {
    // Observed: AniList's english title for this one is null.
    const c = [syn(761, 'NARUTO: Akaki Yotsuba no Clover wo Sagase', 'SPECIAL', null,
      ['Naruto: Find the Crimson Four-leaf Clover!'])]
    assert.equal(pickFilmCandidate(c, 'Naruto Find the Crimson Four-Leaf Clover!', 'Naruto').id, 761)
  })

  test('tolerates two extra tokens in the AniList title but not three', () => {
    const two = [syn(1, 'Franchise: Alpha Beta Gamma Delta', 'MOVIE', null)]
    assert.equal(pickFilmCandidate(two, 'Franchise Gamma Delta', 'Franchise').id, 1)
    const three = [syn(1, 'Franchise: Alpha Beta Epsilon Gamma Delta', 'MOVIE', null)]
    assert.equal(pickFilmCandidate(three, 'Franchise Gamma Delta', 'Franchise'), null)
  })

  test('never accepts a shorter title than the one we asked for', () => {
    // The relaxation is one-directional: the entry may say more than the
    // source row, never less, or "Broly" would take "Broly: Second Coming".
    const c = [syn(1, 'Franchise: Broly', 'MOVIE', null)]
    assert.equal(pickFilmCandidate(c, 'Franchise Broly Second Coming', 'Franchise'), null)
  })

  test('rejects a candidate that does not carry the franchise itself', () => {
    // Observed: searching the bare row title "Kids" returns "Vampiyan Kids",
    // which the token rule alone would accept. Requiring the entry to name the
    // franchise on its own is what makes a bare-title query safe.
    const c = [syn(3290, 'Vampiyan Kids', 'TV', null), syn(3291, 'Vampiyan Kids OVA', 'OVA', null)]
    assert.equal(pickFilmCandidate(c, 'Fullmetal Alchemist Kids', 'Fullmetal Alchemist'), null)
  })

  test('omits when the relaxed rule matches two entries', () => {
    // Observed: "Naruto Shippuden" covers the Shippuden movie AND each of its
    // titled sequels. Ambiguous means omit, exactly as on the exact rung.
    const c = [
      syn(2472, 'NARUTO: Shippuuden Movie', 'MOVIE', 'Naruto Shippuden the Movie'),
      syn(4437, 'NARUTO: Shippuuden - Kizuna', 'MOVIE', 'Naruto Shippuden the Movie: Bonds')
    ]
    assert.equal(pickFilmCandidate(c, 'Naruto Shippuden', 'Naruto'), null)
  })

  test('without a franchise only the exact rung runs', () => {
    const c = [syn(2889, 'Bleach the Movie: The DiamondDust Rebellion', 'MOVIE', null)]
    assert.equal(pickFilmCandidate(c, 'Bleach The DiamondDust Rebellion', 'Bleach').id, 2889)
    assert.equal(pickFilmCandidate(c, 'Bleach The DiamondDust Rebellion'), null)
  })

  test('a series disambiguator in the franchise cannot block the match', () => {
    const c = [syn(13271, 'HUNTER\u00d7HUNTER: Phantom Rouge', 'MOVIE', 'Hunter x Hunter: Phantom Rouge')]
    assert.equal(pickFilmCandidate(c, 'Hunter x Hunter (2011) Phantom Rouge', 'Hunter x Hunter (2011)').id, 13271)
  })
})

describe('filmSearchTerms', () => {
  test('falls back to the bare row title', () => {
    assert.deepEqual(
      filmSearchTerms('Hunter x Hunter (2011)', 'Phantom Rouge'),
      ['Hunter x Hunter (2011) Phantom Rouge', 'Phantom Rouge']
    )
  })

  test('offers one term when the title already carries the franchise', () => {
    assert.deepEqual(filmSearchTerms('One Piece', 'One Piece: The Movie'), ['One Piece: The Movie'])
  })
})
