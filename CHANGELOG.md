# Changelog

## Unreleased

- **Rapid Brewer sits between AeroPress and pour-over** in every table, list and picker (finest → coarsest), and in the library files.
- **Can't-do shows as "—"** in the grind guide and converter instead of a yellow warning (hover or a screen reader still gives the reason). Rows with no range yet keep "No conversion data yet — add starting ranges for this grinder · Edit grinder", in plain text. The guide's stale "K-Ultra ranges are from the original guide" line is gone.
- **"Estimate the empty rows"** in the gear editor fills a grinder's missing grind ranges from its other ranges, marks them "est." and writes how they were worked out. It says which rows it couldn't fill and what they'd need. The rules are data, in `catalog/estimate-rules.json` (e.g. cold brew = the French press range moved half its width coarser), and are the same ones behind the library's estimated rows: `npm test` checks the library's rule-made estimates match them.
- **"Can do" per brew method replaces "Espresso-capable".** Each row of a grinder's range table has a box: untick a method the grinder can't do and its range goes away, conversions to it say "<grinder> can't grind for <method>", and the grinder picker marks it. Library grinders come marked (e.g. the Ode Gen 2 and ZP6 can't do Turkish or espresso). Grinders saved as not espresso-capable are migrated to "can't do espresso".
- **No more summary box above the grind ranges.** Everything it showed is in the fields below; a library grinder whose ranges still match the library just says so in one line.
- **Grind-for-dose is a setting** (More → "Grind for a different dose"): switch it off, choose how far the grind moves per doubling of the dose (% of the grinder's range for that grind category, 20% by default), and which grind categories it applies to (pour-over, drip coffee maker and Rapid Brewer by default). The card explains the scaling (it follows the ratio: each doubling moves the grind the set amount, each halving the same amount finer, so 1½× moves about 58% as far as 2×) with a table worked out on your own grinder.
- **Any library grinder can be rebuilt by hand:** the gear editor now also edits where the ranges come from (the maker's chart, a community chart, or your own), which rows are estimated, and how the estimates were worked out. The step field takes fractions (1/3 for an Ode-style dial). Tests rebuild every library entry as custom gear and check that each field matches. The source box above the ranges is now one line; tap it for the notes.
- **Custom gear can say everything library gear can:** the gear editor now edits per-category notes (e.g. "can't do espresso"), dial notation (Ode-style thirds) and the dial divisor, which only library entries could carry before. Saving a library grinder unchanged no longer shows "your ranges differ from the library".
- **Gear is grinders and brewers only.** The "Other (scales, kettles, accessories)" section is gone: nothing else in the app used those entries. Existing ones are kept and still listed under "Other" so they can be removed; new ones can't be added.
- **Grind categories match a grind chart:** Turkish, espresso, moka pot, AeroPress, pour-over (V60), drip coffee maker, French press, cold brew (plus Rapid Brewer). Every brewer belongs to one ("Grind category" in the gear editor, suggested from its Kind), and the library rules now require it. New library brewers cover the gaps: a cezve (Turkish), Hario Mizudashi and Toddy (cold brew), Hario Technica siphon, Melitta 1x4, Moccamaster KBGV and Flair 58.
- **Every library grinder now covers every method it can do:**
  - Ranges taken from the maker's chart are used as given (e.g. 1Zpresso's Turkish and moka ranges).
  - Gaps are **estimated** by extrapolating the grinder's own charted ranges. They're marked "est." in the gear editor, with a note on how they were worked out.
  - Methods a grinder can't do say why (e.g. the Ode Gen 2 has no espresso).
  - New ranges: Comandante C40, DF64 Gen 2, Fellow Opus, Timemore S3 and Baratza Virtuoso+ (from Honest Coffee Guide's community charts), and the Baratza Encore ESP (from Baratza's manual).
  - The Eureka Mignon Specialità still has none: its published chart uses a dial notation that couldn't be pinned down.
- **Each grinder has its own editable source.** The box above the ranges now says where they come from (the maker's chart, a community chart, or your own), with a **Source link** and notes you can edit. That's useful for a custom grinder you've calibrated. Typing over an estimated range clears its "est." mark, and "Suggest to the library" starts from this source.
- **Library updates reach installed grinders at startup.** A grinder whose ranges still match the library gets the new ranges and source. One you've edited keeps your ranges and only gains methods it doesn't have (and none you've written a note against).
- **"Always leave out" rules are yours:**
  - They used to be three fixed rules from the original spec. Now each is a name plus words to look for, and you can edit the words, remove a rule, restore the starter rules, or add your own.
  - Five more starter rules are offered, all off: decaf, dark roasts, blends, robusta, smoky.
  - The research prompt lists each rule's words.
- **The taste quiz covers the coffee flavour wheel:** apple & pear, grape & wine-like, dried fruit, herbal, honey, vanilla, brown sugar & molasses, malty & cereal, and funky / boozy as things you can *like*; smoky, herbal / grassy, spice-forward, heavy body and thin / watery as dislikes; co-fermented and wet-hulled processes; medium-light and medium-dark roasts.

- **Grind settings are plain numbers.** You type and see exactly what you set on the grinder: `88`, `5.0` or `5.1`. The grinder's unit word (clicks, rotations) is shown next to the field, and the "(dial 8.8)" readout is gone. Older text settings such as "72 clicks (dial 7.2)", "ZP6: 4.5-5" or "setting 5.1" are converted once at startup, after restoring a backup, and when an older client sends text. A range becomes its midpoint, and text with no number in it is cleared. The Fellow Ode's sub-steps are still typed as on the dial (5.1 = 5⅓).
- **Brew setup** replaces "Scale it, then brew":
  - **Water temperature** can be changed before brewing, and again in the log step before saving. The Brew Log keeps what you actually used.
  - **The timer doesn't start on its own.** *Ready to brew* opens the timer screen at 0:00, and *Start timer* starts it when you begin pouring.
- **Grind follows the dose on drip methods** (pour-over, Rapid Brewer, batch). A bigger bed drains slower, so each doubling of the dose moves the grind 20% of that method's range coarser, and each halving moves it finer. The screen says so ("a touch coarser: 75 clicks instead of 72"), and one tap goes back to the recipe's grind. Typing your own number turns the nudge off. Immersion, AeroPress and espresso aren't nudged.

- **Duplicate a bag:** Stash → ⋯ → *Duplicate* starts a new bag pre-filled from an existing one, for when you buy more than one bag of a coffee. It copies the name, roaster, origin, process, roast level, roast and purchase dates, size, price, link, notes and photo. The opened and finished dates and the rating start empty. Nothing is saved until you tap Save, so you can change the roast date first.

- **Bag photos from anywhere:** take a photo, choose one from Photos or Files, paste an image (button or ⌘V/Ctrl+V), or drag and drop it on a desktop. It was camera-only before. Images are converted to a JPEG (longest side 2048 px) on the device, so HEIC photos, screenshots and pasted PNGs all work and upload faster. Attaching a photo to an existing bag gets the same options.
- **Look it up online:** after reading the label, a provider with web search finds the coffee on the roaster's own site.
  - The product page is read by the link importer; the AI's own read of the page only fills gaps.
  - It fills only empty fields, shows which fields came from the web, and adds the roaster's link.
  - It works with Anthropic, OpenAI and Gemini. There's a manual "Look it up online" button too.
- **Layout audit fix:** a timer left running by an earlier screen could cover the next one. The audit now clears the running brew before the app starts, which removes the long-standing "Save to Brew Log" flake.

- **Kingrinder K6 grind ranges** from the KINGrinder K4/K6 manual: espresso 40–60, AeroPress 60–80, pour-over 80–100 clicks. French press is a single setting (140), so the K6 has no immersion range.
- **More sourced grind ranges.** 12 of the library's grinders now convert out of the box, each from the manufacturer's own chart or manual:
  - 1Zpresso ZP6 Special, K-Ultra, J-Max, JX and Q2 (1Zpresso's grind setting charts);
  - Timemore C2 and C3 (Timemore manual);
  - Niche Zero (Niche's grind size guide);
  - Breville Smart Grinder Pro (instruction book);
  - Fellow Opus 2 (new entry; Fellow's getting-started guide);
  - plus the existing Fellow Ode Gen 2 and Baratza Encore.
- **Still without ranges, because no per-method range from the maker was available:**
  - Comandante C40, Timemore S3, DF64, Eureka Mignon: no official per-method chart found;
  - Baratza Encore ESP: no chart found yet;
  - Baratza Virtuoso+: single settings, not ranges;
  - Fellow Opus (original): only the Opus 2 guide was found.
- **ZP6 settings are dial numbers now**, as 1Zpresso labels them ("setting 4.5"), not rotations. The JX and Q2 use rotations, as their charts do.
- A seed `setup.json` can set per-install `units` as well as `grindRanges`.

- **Suggest to the library:** the gear editor turns custom gear into a ready-to-submit library entry, or proposes your grind ranges for a library model. It's checked with the same rules as CI and comes with Copy, Download and "Open on GitHub" (a pre-filled new file).
- **Stricter library rules**, shared by the app, tests and CI (`npm run check:catalog`): cited https sources only, ranges inside the grinder's min/max, type ↔ category consistency, plain-English errors.
- Pull-request template for library contributions.

## 0.1.0 — first public release

- Brew: recipes with a guided timer, ratio calculator, grind guide and grind converter (positional, per brew method), stash, brew log, gear.
- Gear & recipe library as data (`catalog/`): pick your gear, or add your own; grind ranges only with a cited source.
- First-run setup: your brewers and grinders (with a calibration helper for unlisted grinders), units (g/oz, °C/°F), starter recipes that fit your gear, demo data, restore from an export.
- Discover: weekly board that starts with popular picks and learns from your ratings; optional AI provider (Anthropic, OpenAI, Gemini, OpenAI-compatible) set in the app with a write-only key; avoid-rule toggles and suggestions; optional taste quiz.
- Installable PWA; nightly backups and JSON export.
