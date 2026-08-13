# filler-data

A self-owned anime filler-episode dataset, scraped from
[animefillerlist.com](https://www.animefillerlist.com) and keyed by AniList
media ID. Built to replace a third-party dataset that Ake previously fetched
at runtime from an unlicensed (all-rights-reserved) repo, so the pipeline and
the output can carry a real license.

## Output schema

`filler.json` is a flat object:

```json
{ "<anilistId>": [<filler episode numbers, ascending>], ... }
```

- Keys are AniList media IDs, as strings.
- Values are ascending arrays of 1-indexed episode numbers considered filler.
- Shows with zero filler episodes are omitted entirely (no empty-array
  entries).

This is a drop-in replacement for the shape Ake already consumes.

## Data sources

1. **[animefillerlist.com/shows](https://www.animefillerlist.com/shows)** —
   the show index (~356 shows) and each show's episode table. Episode rows
   are classed `manga_canon`, `anime_canon`, `mixed_canon/filler`, or
   `filler`.
2. **[graphql.anilist.co](https://graphql.anilist.co)** — resolves each
   show's title to an AniList media ID via an unauthenticated GraphQL query.

## What counts as "filler"

Only rows classed **`filler`** are included. Rows classed
**`mixed_canon/filler`** are excluded, because they contain real story
content — Ake auto-skips filler during playback, and skipping a mixed
episode would skip canon.

This was verified empirically, not assumed. Across a validation set of 12
shows (Naruto, Bleach, One Piece, Naruto Shippuden, Fairy Tail, Dragon Ball,
Inuyasha, Detective Conan, Fullmetal Alchemist, Fullmetal Alchemist:
Brotherhood, Yu Yu Hakusho, Boruto), the pure-`filler`-only episode list
matched the pre-existing third-party dataset **exactly** (11/11 shows that
had an entry in that dataset; the 12th, Yu Yu Hakusho, has zero pure-filler
episodes and — consistent with this interpretation — has no entry in the old
dataset at all, despite having 4 `mixed_canon/filler` episodes). Combining
`filler` + `mixed_canon/filler` did not match any show. animefillerlist.com's
own per-show summary text (e.g. "90 reported filler episodes" for Naruto)
also only ever counts pure `filler` rows.

## Regenerating the dataset

```bash
node scrape.js
```

This performs a full scrape of every show on animefillerlist.com and
overwrites `filler.json`. Pass `--limit N` to cap the number of shows
processed (useful for local testing — do not run a full scrape while
developing).

### Crawl delay — read this before running anything

`animefillerlist.com/robots.txt` sets `Crawl-delay: 10`. `scrape.js` enforces
a 10-second gap between every request to that host and never issues
concurrent requests to it. **A full run therefore takes roughly one hour.**
This is intentional and must not be shortened — see `.github/workflows/update.yml`,
which is the only place a full run should happen.

Show pages and AniList lookups are cached under `.cache/` so an interrupted
run can be re-run without re-fetching what it already has (delete `.cache/`
to force a clean re-scrape).

## Regeneration schedule

`.github/workflows/update.yml` runs a full scrape weekly (this data changes
slowly — new episodes air, but filler classifications are rarely revised) and
commits `filler.json` only when it changes.

## License

GPL-3.0-or-later. See `LICENSE`.
