// Curated per-season episode map for animefillerlist franchise pages.
//
// A franchise page numbers every season continuously (My Hero Academia runs
// 1-170) while an AniList id addresses one season, so the page's filler
// numbers are meaningless until they are split back out. This table does that
// split explicitly. It is curated by hand and never inferred: a franchise is
// admitted only when its seasons' AniList episode counts sum to exactly the
// number of episode rows the page lists, which pins every boundary without
// guessing. Chronological order is the page's order.
//
// Everything here fails closed. Any doubt yields no marks at all, because
// over-marking makes a consumer silently skip canon.

// Season lists are in page order; the trailing sum is the boundary oracle.
export const FRANCHISE_SEASONS = {
  gantz: {
    pageEpisodes: 26,
    seasons: [
      { id: 384, episodes: 13 },   // GANTZ
      { id: 395, episodes: 13 },   // GANTZ 2
    ],
  },
  'nanatsu-no-taizai': {
    pageEpisodes: 100,
    seasons: [
      { id: 20789, episodes: 24 },  // Nanatsu no Taizai
      { id: 21385, episodes: 4 },   // Seisen no Shirushi
      { id: 99539, episodes: 24 },  // Imashime no Fukkatsu
      { id: 108928, episodes: 24 }, // Kamigami no Gekirin
      { id: 116752, episodes: 24 }, // Funnu no Shinpan
    ],
  },
  'my-hero-academia': {
    pageEpisodes: 170,
    seasons: [
      { id: 21459, episodes: 13 },  // Boku no Hero Academia
      { id: 21856, episodes: 25 },  // 2
      { id: 100166, episodes: 25 }, // 3
      { id: 104276, episodes: 25 }, // 4
      { id: 117193, episodes: 25 }, // 5
      { id: 139630, episodes: 25 }, // 6
      { id: 163139, episodes: 21 }, // 7
      { id: 182896, episodes: 11 }, // FINAL SEASON
    ],
  },
  'high-school-dxd': {
    pageEpisodes: 49,
    seasons: [
      { id: 11617, episodes: 12 },  // High School DxD
      { id: 15451, episodes: 12 },  // NEW
      { id: 20745, episodes: 12 },  // BorN
      { id: 97767, episodes: 13 },  // HERO
    ],
    // Held: the incumbent already claims 20745 with the franchise numbers, so emitting the season numbers needs human sign-off.
    hold: 'incumbent claims 20745 as [34,35,36]; correcting it registers as an over-mark in the differential audit',
  },
}

// Returns a Map of AniList id -> ascending season-local episode numbers, or
// null if the franchise cannot be mapped with certainty.
export function mapFranchiseFiller(slug, filler, pageEpisodes, table = FRANCHISE_SEASONS) {
  const entry = table[slug]
  if (!entry) return null
  if (entry.hold) return null
  // The page grew or shrank since the table was curated, so the boundaries no longer hold.
  if (pageEpisodes !== entry.pageEpisodes) return null
  const total = entry.seasons.reduce((n, s) => n + s.episodes, 0)
  // The table itself is inconsistent, which means at least one boundary is unpinned.
  if (total !== entry.pageEpisodes) return null

  const out = new Map()
  for (const n of filler) {
    let base = 0
    let hit = null
    for (const s of entry.seasons) {
      if (n > base && n <= base + s.episodes) {
        hit = { id: s.id, ep: n - base }
        break
      }
      base += s.episodes
    }
    // A number no season can hold means the table does not describe this page.
    if (!hit) return null
    if (!out.has(hit.id)) out.set(hit.id, [])
    out.get(hit.id).push(hit.ep)
  }
  for (const eps of out.values()) eps.sort((a, b) => a - b)
  return out
}
