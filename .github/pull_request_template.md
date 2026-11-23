<!-- Thanks! For gear and grind ranges, see CONTRIBUTING.md. -->

## What this changes

## For gear / grind-range submissions
- [ ] One file per model in `catalog/gear/`, file name = `id`
- [ ] Grind ranges (if any) are copied per brew method from the cited source — not converted from microns or size bands
- [ ] `rangeInfo.source` is an https link anyone can open, and `rangeInfo.note` quotes what it says
- [ ] Updating an existing entry? `version` is bumped
- [ ] `npm run check:catalog` passes (CI runs it too)

## For code changes
- [ ] `npm run typecheck` and `npm test` pass
- [ ] UI changes: ran `tests/e2e` (onboarding + layout audit on a phone viewport)
