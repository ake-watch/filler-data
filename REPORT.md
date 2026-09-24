# Report: filler-data build

## Status

Complete for the scope of this task: scraper, validation harness, partial
(12-show) dataset, license, README, and scheduled workflow are all committed
locally to a fresh repo at ~/projects/filler-data. No GitHub repo was
created and nothing was pushed. ~/projects/ake was not touched.

## Commits (in order)

| SHA | Subject |
|---|---|
| e83fcf7acbf4008367b6d321533348d0d007067f | chore: project scaffold, GPL-3.0-or-later license |
| 609e32908093a47ba1c4260e6f069131a237ef9e | feat: clean-room scraper for animefillerlist.com -> AniList filler map |
| 61a5b1e0c91686373fd291a75954060d7ccfdfc6 | test: validate pure-filler-only interpretation against old dataset |
| a37c0f5c5a13e603d61cf90066c3b9d7d93ab69e | docs: README + scheduled full-refresh workflow |

Git identity used: user.name = ake-app, user.email =
312243255+ake-app@users.noreply.github.com (set before the first commit).

## The mixed_canon/filler question, answered with evidence

**Only pure `filler` rows count as filler. `mixed_canon/filler` rows are
excluded.**

Evidence, in order of strength:

1. **Exact match against the old dataset.** I fetched 12 shows (respecting
   the 10s crawl-delay), chosen because they're heavy users of
   `mixed_canon/filler` (Naruto, Bleach, One Piece, Naruto Shippuden, Fairy
   Tail, Dragon Ball, Inuyasha, Detective Conan, Fullmetal Alchemist,
   Fullmetal Alchemist: Brotherhood, Yu Yu Hakusho, Boruto). For every one of
   the 11 shows that had an entry in the old third-party dataset, the
   pure-filler-only episode list matched byte-for-byte (same count,
   same episode numbers, same order). The interpretation "filler +
   mixed_canon/filler combined" matched zero of the 11.
2. **The 12th show is a negative-control confirmation.** Yu Yu Hakusho has 0
   pure-filler episodes but 4 mixed_canon/filler episodes. It has no
   entry at all in the old dataset, consistent with the old dataset never
   counting mixed_canon/filler as filler (if it did, Yu Yu Hakusho would
   have a 4-episode entry).
3. **The source site's own stated numbers agree.** animefillerlist.com's
   Naruto page states "In total 220 episodes of Naruto were aired. With a
   total of 90 reported filler episodes, Naruto has a high filler percentage
   of 41%." 90/220 = 40.9%. My parse of Naruto's episode table found exactly
   90 rows classed filler (manga_canon: 74, mixed_canon/filler: 56,
   filler: 90; 74+56+90=220). The site itself does not fold
   mixed_canon/filler into its own filler count.

This also happens to be the correct call for Ake's use case, independent
of bit-compatibility: mixed_canon/filler episodes contain real story
content interleaved with filler, so auto-skipping them during playback would
skip canon. Even if the old dataset had included them, I'd have recommended
excluding them for correctness. Here the two considerations point the same
way, which removes any tension.

## Validation

- Shows validated: 12 (well under the 15-show dev cap in the brief).
- Match rate: 11/11 (100%) of shows with an old-dataset entry matched
  exactly under the pure-filler-only interpretation. (The 12th, Yu Yu
  Hakusho, has no old-dataset entry to compare against, but its absence is
  itself confirming evidence; see above.)
- filler.json currently contains 11 entries, generated from this
  validation subset only. This is explicitly not a full run: the
  README and the commit message both flag it as partial. The scheduled
  GitHub Actions workflow (.github/workflows/update.yml, not yet run,
  since I did not push) is where the real ~356-show scrape happens.

## Estimated full-run duration

~356 shows in the index. scrape.js issues exactly one request per show to
animefillerlist.com (plus one for the index page), gated at 10s intervals
per robots.txt's Crawl-delay: 10, with zero concurrency:

- animefillerlist.com: (356 + 1) x 10s ~= 59.5 minutes
- AniList GraphQL lookups only fire for shows that actually have filler
  episodes (~122 in the old dataset, likely similar here), at a
  self-imposed 1.5s gap: ~122 x 1.5s ~= 3 minutes, additive since it
  happens in-line per show.

Total estimate: ~60-65 minutes, matching the brief's "~1 hour" figure.
The workflow sets timeout-minutes: 120 for headroom.

## Concerns

- AniList title matching is fuzzy-search based, using AniList's search
  field with a single Media query and no disambiguation beyond
  type: ANIME. For the 12 validated shows this resolved correctly every
  time, but at full scale (~356 shows) some titles will likely mismatch or
  fail to resolve: sequels, OVAs, "Films"/"Specials" compilation entries,
  and titles with unusual punctuation are the most likely failure modes
  (the show index itself has some data-entry quirks, e.g. "Attack on Titan
  Films" links to a slug that looks unrelated to the title, worth
  spot-checking after the first full run).
- The 15-show dev cap was respected (used 12), but that means ~344 shows
  are still statistically unvalidated. The pattern (pure-filler-only,
  confirmed three independent ways) is strong, but a full run should be
  spot-checked against the old dataset for a larger sample before the
  workflow's output is treated as final/authoritative.
- scrape.js's AniList resolution has no manual override/alias table. Shows
  where automated title search fails are simply dropped from the output
  (logged as "no AniList match, skipping") rather than causing a build
  failure. This favors availability over completeness, worth a follow-up
  pass to add a small alias table for known-tricky titles once a full run
  surfaces them.
- I did not create a GitHub repo or push, per the brief. The workflow file
  is therefore untested against a real Actions runner.
