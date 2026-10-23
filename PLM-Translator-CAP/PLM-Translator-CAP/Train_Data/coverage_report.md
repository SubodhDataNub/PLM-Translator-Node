# Coverage report: label terminology database

Collected on 30 September and 1 October 2026. Every official text was fetched with Apify (Cheerio Scraper) from the EU Publications Office's Cellar repository and parsed by code inside Apify. Nothing was typed or translated by hand.

## Sources used

| Category | Source | Version | Languages filled |
|---|---|---|---|
| Hazard (H, EUH) and precautionary (P) statements | Regulation (EC) No 1272/2008 (CLP), Annexes III and IV | consolidated 2026-07-01 (CELEX 02008R1272-20260701) | en, da, nl, fr, it, pt-PT, es |
| Food additives | Regulation (EC) No 1333/2008, Annex II, Part B | consolidated 2026-08-18 (CELEX 02008R1333-20260818) | en, da, nl, fr, it, pt-PT, es |
| Food allergens | Regulation (EU) No 1169/2011, Annex II | consolidated 2025-04-01 (CELEX 02011R1169-20250401) | en, da, nl, fr, it, pt-PT, es |
| Fragrance allergens | Regulation (EC) No 1223/2009, Annex III | consolidated 2026-05-18 (CELEX 02009R1223-20260518) | kept as-is in all languages |
| INCI names | Commission Implementing Decision (EU) 2025/1175, glossary of common ingredient names | as published | kept as-is in all languages |
| Units and code patterns | Directives 76/211/EEC, 80/181/EEC and 2011/91/EU; BIPM SI Brochure; Commission Recommendation 2006/647/EC | n/a | kept as-is in all languages |

## How the text was handled

- EUR-Lex amendment and correction markers and footnote call-outs were removed. The text they enclose is kept.
- Runs of spaces, tabs and line breaks were collapsed to one space. Non-breaking spaces were kept as in the source.
- Sub-points of an allergen entry were joined with single spaces, keeping their (a), (b) labels. Closing punctuation is kept.
- E-numbers are normalised in the code column only (E 414 becomes E414). The names are untouched.
- H/P codes, including combinations such as P301 + P310, are kept exactly as written in the source.
- CLP: the English edition of Annexes III and IV lists every EU language version of each statement, and all EU cells come from those lists.
- head_term is the text before the first of a fixed list of phrases per language (for example ", namely" or " and products thereof"). It is always an exact prefix of the official entry and is left empty if no phrase matched.
- Fragrance allergens are all Annex III entries whose conditions require their presence to be indicated in the list of ingredients (Article 19(1)(g)).
- Fragrance-allergen entries that list several ingredient names in one Annex III cell are split into one row per name. CAS numbers are paired with names only when the source cell lists exactly one name per line and the counts match; otherwise cas_number is left empty and the row is flagged.
- The newer EUH codes are written with a space in the source (EUH 380). The code column removes that space (EUH380) so it works as a lookup key, exactly as E 414 becomes E414. The statement text is untouched.
- Where the source's layout put a non-breaking space next to an ordinary space (for example after a sub-point label such as "(a)"), the pair was collapsed to the single non-breaking space of the source.
- needs_review is yes when a language cell is missing, a leftover marker was detected, an additive name conflicted within one language, a head term could not be cut, or (do_not_translate) a CAS number was paired with a name by line order or could not be paired at all.

## Gaps

### H/P statements
- ar, zh-CN: the source would be UN GHS Rev.10, the latest revision published in Arabic and Chinese (Rev.11 exists only in English, French and Spanish). Not collected, because unece.org returned HTTP 403 to automated downloads. Needs a manual download.
- zh-CN (GB 30000) and ja (JIS Z 7253): no licensed copies. Gap.
- pt (Brazil): ABNT NBR 14725 is a paid standard. Gap.
- tr, id: official national versions not checked in this run. hi, ta: no official version identified. Gap.
- EUH statements exist only in EU law, so they stay empty outside the EU languages.
- A CLP consolidated version dated 2027-01-01 already exists. This run uses the version in force today (2026-07-01) and did not compare the two.

### Food additives
- ar, zh-CN, hi, id, tr: Codex CXG 36-1989 was not collected (fao.org returned HTTP 403). The national lists (GB 2760-2024, FSSAI, BPOM, Turkish Food Codex) were not collected in this run.
- ja: left empty by decision, because the MHLW lists do not carry INS or E numbers.
- pt (Brazil): the ANVISA list was not collected in this run.
- ta: no official source identified.

### Food allergens
- ar, zh-CN: Codex CXS 1-1985 was not collected (fao.org returned HTTP 403).
- pt (Brazil): the ANVISA list was not collected. It would be used only for clear one-to-one matches.
- hi, id, ja, ta, tr: no source in scope.

### INCI names
- The CosIng inventory export was not available. Its API export requires authentication (HTTP 401) and the data.europa.eu catalogue returned no download link. INCI names therefore come from the 2025 glossary, which has no CAS or EC numbers, so cas_number is empty for inci rows.
- zh-CN and ja: China (IECIC standard Chinese names) and Japan (JCIA labelling names) may require official local ingredient names on labels, so "keep INCI as-is" may not be compliant for those markets.
- Some glossary names are also everyday words. Apply INCI protection only inside the ingredient lists of cosmetic and detergent labels, not to food text.

### Fragrance allergens
- "Eucalyptol" does not appear anywhere in the consolidated Annex III, so it is not listed. Eucalyptus Globulus Leaf Oil is listed, as an entry in its own right.
- Several entries name a botanical extract or oil rather than a single chemical. These are kept as written and are safe to protect as-is.
- Entries whose names could not be paired with CAS numbers are flagged with needs_review=yes and have an empty cas_number. They still carry their Annex III entry number, so the pairing can be checked against the source.

### Checks computed on the data

- INCI glossary names skipped as duplicates of a fragrance-allergen term or of another glossary name: 105.
- Glossary names that are also everyday words (checked against a short list): ALCOHOL, BEER, BUTTER, CREAM, EGG, GELATIN, GLUCOSE, GLYCERIN, HONEY, MILK, SUCROSE, VINEGAR, WATER, WINE, YEAST, YOGURT.

## Counts: official_terms.csv (cells filled per language)

| category | rows | needs_review=yes | en | ar | zh-CN | da | nl | fr | hi | id | it | ja | pt | pt-PT | es | ta | tr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hazard_statement | 113 | 0 | 113 | 0 | 0 | 113 | 113 | 113 | 0 | 0 | 113 | 0 | 0 | 113 | 113 | 0 | 0 |
| precautionary_statement | 128 | 0 | 128 | 0 | 0 | 128 | 128 | 128 | 0 | 0 | 128 | 0 | 0 | 128 | 128 | 0 | 0 |
| food_additive | 339 | 1 | 339 | 0 | 0 | 339 | 339 | 338 | 0 | 0 | 339 | 0 | 0 | 339 | 339 | 0 | 0 |
| food_allergen | 14 | 1 | 14 | 0 | 0 | 14 | 14 | 14 | 0 | 0 | 14 | 0 | 0 | 14 | 14 | 0 | 0 |

## Counts: do_not_translate.csv

| category | rows | needs_review=yes |
|---|---|---|
| unit_symbol | 13 | 1 |
| code_pattern | 6 | 1 |
| fragrance_allergen | 105 | 37 |
| inci | 30313 | 0 |

## Rows still needing review in official_terms.csv

- food_additive E960b: missing fr
- food_allergen (no code): missing 