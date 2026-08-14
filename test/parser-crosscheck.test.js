// Independent-oracle cross-check for the production show-page parser.
//
// animefillerlist publishes each show's classification TWICE, in two
// unrelated places and two different formats:
//
//   1. the episode table  -- one <tr class="filler" id="eps-N"> per episode
//   2. the "Quick List"   -- <div id="Condensed"> with a single
//                            <div class="filler"> carrying a comma-separated
//                            range string such as "26, 97, 101-106, 143-219"
//
// parseShowPage() reads (1). This suite derives the same answer from (2) with
// completely separate code and asserts they agree. Because the two encodings
// are maintained by the site independently, agreement is real evidence the
// parser is correct -- re-parsing (1) with a copy of the same logic would be
// circular and prove nothing.
//
// Hermetic: reads only pages already in .cache/shows, never the network. The
// scraper honours a 10s Crawl-delay, and that delay is enforced per process,
// so a test suite must never fetch concurrently with a running scrape.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseShowPage } from '../scrape.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOWS = path.join(root, '.cache', 'shows')

// --- the independent oracle ------------------------------------------------

// Pull the Quick List's filler range string. `class="filler"` is exact, so
// `mixed_canon/filler` cannot match it.
function quickListFillerRaw (html) {
  const block = /<div class="filler">\s*<span class="Label">[^<]*<\/span>\s*<span class="Episodes">([\s\S]*?)<\/span>\s*<\/div>/.exec(html)
  return block ? block[1] : null
}

// "26, 97, 101-106" -> [26, 97, 101, 102, 103, 104, 105, 106]
function expandRanges (raw) {
  const text = raw
    .replace(/<[^>]*>/g, '')       // drop the <a> wrappers
    .replace(/&nbsp;/g, ' ')
    .trim()
  if (!text) return []
  const out = []
  for (const part of text.split(',')) {
    const piece = part.trim()
    if (!piece) continue
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece)
    if (range) {
      const lo = parseInt(range[1], 10)
      const hi = parseInt(range[2], 10)
      assert.ok(lo <= hi, `inverted range ${piece}`)
      for (let n = lo; n <= hi; n++) out.push(n)
    } else {
      const single = /^\d+$/.exec(piece)
      assert.ok(single, `unparseable Quick List token ${JSON.stringify(piece)}`)
      out.push(parseInt(piece, 10))
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// --- corpus ----------------------------------------------------------------

const pages = existsSync(SHOWS)
  ? readdirSync(SHOWS).filter(f => f.endsWith('.html')).sort()
  : []

describe('parser cross-check against the site\'s own Quick List', () => {
  test('there is a corpus to check', () => {
    assert.ok(pages.length > 0, 'no cached show pages -- run the scraper first')
  })

  test('row-derived filler equals summary-derived filler, for every cached show', () => {
    const mismatches = []
    let checked = 0
    let noQuickList = 0

    for (const file of pages) {
      const html = readFileSync(path.join(SHOWS, file), 'utf8')
      const raw = quickListFillerRaw(html)

      const fromRows = parseShowPage(html).filler
      if (raw === null) {
        // No filler block in the Quick List means the site lists no filler at
        // all; the table must agree.
        noQuickList++
        if (fromRows.length > 0) {
          mismatches.push(`${file}: rows say ${fromRows.length} filler eps, Quick List has no filler block`)
        }
        continue
      }

      const fromSummary = expandRanges(raw)
      checked++
      const same = fromRows.length === fromSummary.length &&
        fromRows.every((n, i) => n === fromSummary[i])
      if (!same) {
        const rowSet = new Set(fromRows)
        const sumSet = new Set(fromSummary)
        mismatches.push(
          `${file}: rows=${fromRows.length} summary=${fromSummary.length}` +
          ` | only-in-rows=[${fromRows.filter(n => !sumSet.has(n)).slice(0, 12).join(',')}]` +
          ` only-in-summary=[${fromSummary.filter(n => !rowSet.has(n)).slice(0, 12).join(',')}]`
        )
      }
    }

    console.log(`    cross-checked ${checked} show(s) with a filler summary; ${noQuickList} with none`)
    assert.deepEqual(mismatches, [],
      `${mismatches.length} show(s) disagree between table and summary`)
  })

  test('the Quick List block is never confused with an episode row', () => {
    // #Condensed uses bare class="filler" -- the same token episode rows use
    // before their odd/even suffix. parseShowPage anchors on
    // <tr ... id="eps-N">, so the summary div must contribute nothing.
    const withSummary = pages.find(f => quickListFillerRaw(readFileSync(path.join(SHOWS, f), 'utf8')))
    assert.ok(withSummary, 'no page with a filler summary in the corpus')
    const html = readFileSync(path.join(SHOWS, withSummary), 'utf8')
    const rows = parseShowPage(html).filler
    // Every parsed number must correspond to a real <tr id="eps-N">.
    for (const n of rows) {
      assert.match(html, new RegExp(`<tr class="[^"]*" id="eps-${n}">`),
        `episode ${n} was parsed but has no matching table row`)
    }
  })
})
