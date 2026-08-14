#!/usr/bin/env node
// Differential audit: this dataset vs the third-party one it replaces.
//
// Answers the only question that matters before switching a consumer over:
// would we ever mark an episode as filler that the incumbent does not? That
// direction is the dangerous one -- a consumer with auto-skip enabled would
// silently eat real episodes. The reverse (we omit a show they cover) is
// benign: no key means nothing is marked, so the feature just does nothing.
//
// Read-only. Run after a full scrape and require 0 over-marks before switching.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const OLD = path.join(here, '.cache', 'old-filler.json')
const NEW = path.join(here, 'filler.json')

const read = p => JSON.parse(readFileSync(p, 'utf8'))
const old = read(OLD)
const nu = read(NEW)

const norm = v => Array.isArray(v) ? [...new Set(v)].sort((a, b) => a - b) : []
const totalEps = o => Object.values(o).reduce((n, v) => n + norm(v).length, 0)

const oldKeys = new Set(Object.keys(old))
const newKeys = new Set(Object.keys(nu))
const both = [...oldKeys].filter(k => newKeys.has(k))
const onlyOld = [...oldKeys].filter(k => !newKeys.has(k))
const onlyNew = [...newKeys].filter(k => !oldKeys.has(k))

const same = []
const diff = []
for (const k of both) {
  const a = norm(old[k])
  const b = norm(nu[k])
  if (a.length === b.length && a.every((x, i) => x === b[i])) same.push(k)
  else diff.push({ k, a, b })
}

const lostEps = onlyOld.reduce((n, k) => n + norm(old[k]).length, 0)

console.log('=== SCALE ===')
console.log(`  incumbent : ${oldKeys.size} shows, ${totalEps(old)} filler episodes`)
console.log(`  ours      : ${newKeys.size} shows, ${totalEps(nu)} filler episodes`)
console.log('')
console.log('=== OVERLAP ===')
console.log(`  in both          : ${both.length}`)
console.log(`    identical      : ${same.length}`)
console.log(`    DISAGREE       : ${diff.length}`)
console.log(`  only incumbent   : ${onlyOld.length}  (${lostEps} episodes we would stop marking)`)
console.log(`  only ours        : ${onlyNew.length}`)
console.log('')

let overMark = 0
if (diff.length) {
  console.log('=== DISAGREEMENTS (each needs an explanation before switch-over) ===')
  for (const { k, a, b } of diff) {
    const aS = new Set(a)
    const bS = new Set(b)
    const extra = b.filter(x => !aS.has(x))
    const missing = a.filter(x => !bS.has(x))
    overMark += extra.length
    console.log(`  id ${k}: theirs=${a.length} ours=${b.length}`)
    if (extra.length) console.log(`    !! WE MARK ${extra.length} THEY DON'T (would skip real eps): ${extra.slice(0, 20).join(',')}`)
    if (missing.length) console.log(`    -- they mark ${missing.length} we don't (safe): ${missing.slice(0, 20).join(',')}`)
  }
  console.log('')
}

console.log('=== RISK SUMMARY ===')
console.log(`  over-marked episodes (DANGEROUS): ${overMark}`)
console.log(`  shows losing filler marking (benign): ${onlyOld.length}`)
console.log('')

if (onlyOld.length) {
  console.log('=== IDs only in incumbent (not yet covered by our scrape) ===')
  console.log('  ' + onlyOld.join(' '))
}
if (onlyNew.length) {
  console.log('')
  console.log('=== IDs only in ours (additions to eyeball) ===')
  console.log('  ' + onlyNew.join(' '))
}

// Non-zero exit iff we would over-mark: usable as a switch-over gate.
process.exit(overMark > 0 ? 1 : 0)
