// Hermetic test suite for the generated dataset.
//
// No network. Reads filler.json and the reference oracle from .cache and
// asserts three independent things:
//   1. SCHEMA    -- the output matches the documented contract
//   2. INVARIANTS-- properties that must hold for any correct dataset
//   3. PARITY    -- differential test against the dataset we replace
//
// Parity is the release gate: a drop-in replacement must cover every show the
// incumbent covers and agree with it everywhere they overlap. Until the full
// scrape completes these fail, and that is the correct signal.
//
// Network provenance checks live in provenance.test.js and are opt-in, so this
// suite stays deterministic and offline-runnable.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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

  test('oracle is present', { skip: haveOracle ? false : 'no .cache/old-filler.json' }, () => {
    assert.ok(Object.keys(oracle).length > 0)
  })

  test('covers every show the incumbent covers', { skip: !haveOracle }, () => {
    const missing = Object.keys(oracle).filter(k => !(k in dataset))
    assert.deepEqual(missing, [],
      `${missing.length} show(s) in the incumbent are absent here -- coverage regression`)
  })

  test('agrees exactly wherever both cover a show', { skip: !haveOracle }, () => {
    const disagreements = []
    for (const k of Object.keys(oracle)) {
      if (!(k in dataset)) continue
      const a = norm(oracle[k])
      const b = norm(dataset[k])
      if (a.length !== b.length || !a.every((x, i) => x === b[i])) disagreements.push(k)
    }
    assert.deepEqual(disagreements, [],
      `${disagreements.length} show(s) disagree with the incumbent`)
  })

  test('never marks an episode filler that the incumbent does not', { skip: !haveOracle }, () => {
    // The only dangerous direction: a consumer with auto-skip enabled would
    // silently drop real episodes. Under-marking is benign by comparison.
    const overMarks = []
    for (const k of Object.keys(oracle)) {
      if (!(k in dataset)) continue
      const a = new Set(norm(oracle[k]))
      for (const ep of norm(dataset[k])) {
        if (!a.has(ep)) overMarks.push(`${k}:${ep}`)
      }
    }
    assert.deepEqual(overMarks, [],
      `${overMarks.length} episode(s) marked filler here but not by the incumbent`)
  })
})
