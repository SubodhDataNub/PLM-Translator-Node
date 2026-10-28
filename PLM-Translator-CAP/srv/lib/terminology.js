'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(config.ROOT_DIR, 'Train_Data');

const LABEL_TYPES = [
    { key: 'auto', sets: null },
    { key: 'general', sets: ['statements', 'codes'] },
    { key: 'food', sets: ['statements', 'codes', 'food'] },
    { key: 'cosmetic', sets: ['statements', 'codes', 'cosmetic'] },
    { key: 'off', sets: [] }
];
const DEFAULT_LABEL_TYPE = 'auto';

const FOOD_CUES = /\b(?:cook(?:ed|ing)?|serv(?:e|ed|ing)|recipe|sauce|meal|bak(?:e|ed|ing)|fry|fried|boil(?:ed|ing)?|microwave|oven|eat|delicious|tast(?:e|y)|flavou?r(?:s|ed|ing)?|nutrition(?:al)?|kcal|kj|saturates|carbohydrates?|protein|fibre|best before|use by|may contain|traces of|allergens?|gluten|lactose|vegan|vegetarian|meat|fish|poultry|vegetables?|fruits?|snack|beverage)\b/gi;
const COSMETIC_CUES = /\b(?:skin|hair|scalp|face|facial|lips?|nails?|shampoo|conditioner|lotion|serum|soap|shower|deodorant|antiperspirant|toothpaste|mouthwash|perfume|parfum|fragrance|cosmetics?|dermatologically|moisturi[sz](?:e|er|ing)|apply|massage|lather|detergent|laundry|washing machine|dishwasher|fabrics?|stains?|bleach|cleaner|cleaning|surfaces?|inci|aqua|spf)\b/gi;
const E_NUMBER = /\bE ?\d{3,4}[a-z]?\b/g;
const COLOUR_INDEX = /\bCI ?\d{5}\b/g;

const EVERYDAY_INCI = new Set([
    'alcohol', 'beer', 'butter', 'cream', 'egg', 'gelatin', 'glucose', 'glycerin',
    'honey', 'milk', 'sucrose', 'vinegar', 'water', 'wine', 'yeast', 'yogurt'
]);

const PLACEHOLDER_PATTERN = /[[［]{2}\s*(\d+)\s*[\]］]{2}/g;

const TRAILING_PUNCTUATION = /[,;.:!?"'”’»]/;
const LEADING_QUOTES = /["'“‘„«]/;

function normalizeLabelType(value) {
    const key = String(value || '').trim().toLowerCase();
    return LABEL_TYPES.some((type) => type.key === key) ? key : DEFAULT_LABEL_TYPE;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            if (c === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n') {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }

    const header = rows.shift() || [];
    return rows
        .filter((r) => r.length > 1)
        .map((r) => Object.fromEntries(header.map((name, idx) => [name, (r[idx] || '').trim()])));
}

const countChar = (s, ch) => s.split(ch).length - 1;

function tokenize(text) {
    const tokens = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const raw = m[0];
        let start = 0;
        let end = raw.length;
        let changed = true;
        while (changed) {
            changed = false;
            while (end > start && TRAILING_PUNCTUATION.test(raw[end - 1])) {
                end--;
                changed = true;
            }
            while (start < end && LEADING_QUOTES.test(raw[start])) {
                start++;
                changed = true;
            }
            const core = raw.slice(start, end);
            if (core.endsWith(')') && countChar(core, ')') > countChar(core, '(')) {
                end--;
                changed = true;
            } else if (core.startsWith('(') && countChar(core, '(') > countChar(core, ')')) {
                start++;
                changed = true;
            }
        }
        tokens.push({
            start: m.index + start,
            end: m.index + end,
            key: raw.slice(start, end).toLowerCase(),
            trailing: raw.slice(end)
        });
    }
    return tokens;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function letters(s) {
    return s.replace(/[^\p{L}]/gu, '');
}

function isAllUpper(s) {
    const l = letters(s);
    return l.length > 1 && l === l.toUpperCase() && l !== l.toLowerCase();
}

function isAllLower(s) {
    const l = letters(s);
    return l === l.toLowerCase();
}

function upper(text, lang) {
    try {
        return text.toLocaleUpperCase(lang);
    } catch (e) {
        return text.toUpperCase();
    }
}

function matchCase(source, target, lang) {
    if (isAllUpper(source)) return upper(target, lang);

    const first = source.match(/\p{L}/u);
    const idx = target.search(/\p{L}/u);
    if (first && first[0] !== first[0].toUpperCase() && idx >= 0) {
        const ch = target[idx];
        const next = target[idx + 1] || '';
        if (ch !== ch.toLowerCase() && next === next.toLowerCase()) {
            let lowered;
            try {
                lowered = ch.toLocaleLowerCase(lang);
            } catch (e) {
                lowered = ch.toLowerCase();
            }
            return target.slice(0, idx) + lowered + target.slice(idx + 1);
        }
    }
    return target;
}

function stripTrailing(target, trailing) {
    const trimmed = target.trim();
    if (trailing && trimmed.endsWith(trailing)) {
        return trimmed.slice(0, -trailing.length).trimEnd();
    }
    return trimmed;
}

class PhraseTrie {
    constructor() {
        this.root = { next: new Map(), entries: [] };
        this.size = 0;
    }

    add(text, entry, { onlyIfFree = false } = {}) {
        const tokens = tokenize(text);
        if (!tokens.length) return false;
        let node = this.root;
        for (const token of tokens) {
            let child = node.next.get(token.key);
            if (!child) {
                child = { next: new Map(), entries: [] };
                node.next.set(token.key, child);
            }
            node = child;
        }
        if (onlyIfFree && node.entries.length) return false;
        node.entries.push({ ...entry, trailing: tokens[tokens.length - 1].trailing });
        this.size++;
        return true;
    }
}

class Terminology {
    constructor(dataDir = DATA_DIR) {
        this.dataDir = dataDir;
        this.loaded = false;
        this.available = false;
        this.tries = {};
        this.codePatterns = [];
        this.unitPatterns = [];
        this.stats = {};
    }

    load() {
        if (this.loaded) return this.available;
        this.loaded = true;

        const officialPath = path.join(this.dataDir, 'official_terms.csv');
        const doNotTranslatePath = path.join(this.dataDir, 'do_not_translate.csv');
        if (!fs.existsSync(officialPath) || !fs.existsSync(doNotTranslatePath)) {
            console.warn(`Terminology not loaded: ${this.dataDir} does not contain official_terms.csv and do_not_translate.csv`);
            return false;
        }

        const startedAt = Date.now();
        try {
            this._loadOfficialTerms(parseCsv(fs.readFileSync(officialPath, 'utf8')));
            this._loadDoNotTranslate(parseCsv(fs.readFileSync(doNotTranslatePath, 'utf8')));
            this.available = true;
            console.log(
                `Terminology loaded in ${Date.now() - startedAt} ms: ${this.stats.statements} official statements, `
                + `${this.stats.food} food terms, ${this.stats.cosmetic} protected cosmetic names, `
                + `${this.codePatterns.length} code patterns, ${this.stats.units} units`
            );
        } catch (e) {
            console.error(`Terminology not loaded: ${e.message}`);
            this.available = false;
        }
        return this.available;
    }

    _loadOfficialTerms(rows) {
        const languages = Object.keys(rows[0] || {}).filter((col) => /^[a-z]{2}(-[A-Z]{2})?$/.test(col) && col !== 'en');
        const statements = new PhraseTrie();
        const food = new PhraseTrie();
        let skippedFillIns = 0;

        const targetsFor = (row, clean, column = (lang) => lang) => {
            const targets = {};
            for (const lang of languages) {
                const value = clean(row[column(lang)] || '');
                if (value) targets[lang] = value;
            }
            return targets;
        };

        for (const row of rows) {
            if (row.category === 'hazard_statement' || row.category === 'precautionary_statement') {
                const fillIns = (row.en.match(/<[^>]*>/g) || []).length;
                const clean = (text) => {
                    if ((text.match(/<[^>]*>/g) || []).length !== fillIns) return '';
                    const stripped = text.replace(/\s*<[^>]*>/g, '').replace(/\s+([.,;:])/g, '$1').trim();
                    return /…|\.\.\./.test(stripped) ? '' : stripped;
                };
                const en = clean(row.en);
                if (!en) {
                    skippedFillIns++;
                    continue;
                }
                statements.add(en, { kind: 'official', label: row.code, targets: targetsFor(row, clean) });
            } else if (row.category === 'food_additive') {
                const clean = (text) => text.replace(/\s*\(\*\d+\)/g, '').trim();
                const en = clean(row.en);
                if (!en) continue;
                food.add(en, { kind: 'official', label: `${row.code} ${en}`, targets: targetsFor(row, clean) });
                const withoutParen = (text) => text.replace(/\s*\([^()]*\)$/, '').trim();
                if (/\)$/.test(en)) {
                    const shortEntry = {
                        kind: 'official',
                        label: `${row.code} ${en}`,
                        targets: targetsFor(row, (text) => withoutParen(clean(text)))
                    };
                    food.add(withoutParen(en), shortEntry, { onlyIfFree: true });
                    const alternative = (en.match(/\(([^()]*)\)$/) || [])[1];
                    if (alternative && /^\p{L}+(\s+\p{L}+)+$/u.test(alternative.trim())) {
                        food.add(alternative.trim(), shortEntry, { onlyIfFree: true });
                    }
                }
            } else if (row.category === 'food_allergen' && row.needs_review !== 'yes') {
                food.add(row.en, { kind: 'official', label: row.head_term_en || row.en, targets: targetsFor(row, (t) => t) });
                if (row.head_term_en && /\s/.test(row.head_term_en)) {
                    food.add(row.head_term_en, {
                        kind: 'official',
                        label: row.head_term_en,
                        targets: targetsFor(row, (t) => t, (lang) => `head_term_${lang}`)
                    }, { onlyIfFree: true });
                }
            }
        }

        this.tries.statements = statements;
        this.tries.food = food;
        this.stats.statements = statements.size;
        this.stats.food = food.size;
        this.stats.skippedFillIns = skippedFillIns;
    }

    _loadDoNotTranslate(rows) {
        const cosmetic = new PhraseTrie();
        const afterNumberUnits = [];
        const wordUnits = [];

        for (const row of rows) {
            if (row.category === 'code_pattern') {
                if (row.needs_review === 'yes') continue;
                try {
                    this.codePatterns.push(new RegExp(row.term, 'g'));
                } catch (e) {
                    console.warn(`Skipping invalid code pattern ${row.term}: ${e.message}`);
                }
            } else if (row.category === 'unit_symbol') {
                if (row.needs_review === 'yes') continue;
                (row.match === 'after_number' ? afterNumberUnits : wordUnits).push(row.term);
            } else if (row.category === 'inci' || row.category === 'fragrance_allergen') {
                const constraint = EVERYDAY_INCI.has(row.term.toLowerCase()) ? 'upper' : 'notLower';
                cosmetic.add(row.term, { kind: 'keep', label: row.term, constraint }, { onlyIfFree: true });
            }
        }

        const alternation = (terms) => terms
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join('|');
        if (afterNumberUnits.length) {
            this.unitPatterns.push(new RegExp(`(?<=\\d[ \\u00a0]?)(?:${alternation(afterNumberUnits)})(?![\\p{L}\\p{N}])`, 'gu'));
        }
        if (wordUnits.length) {
            this.unitPatterns.push(new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(wordUnits)})(?![\\p{L}\\p{N}])`, 'gu'));
        }

        this.tries.cosmetic = cosmetic;
        this.stats.cosmetic = cosmetic.size;
        this.stats.units = afterNumberUnits.length + wordUnits.length;
    }

    protect(text, targetLanguage, labelType = DEFAULT_LABEL_TYPE) {
        const key = this.resolveLabelType(text, labelType);
        const type = LABEL_TYPES.find((t) => t.key === key);
        if (!type.sets.length || !text || !this.load()) return null;
        if (/[[［]{2}/.test(text)) return null;

        const spans = this._phraseSpans(text, targetLanguage, type.sets);
        if (type.sets.includes('codes')) {
            for (const pattern of [...this.codePatterns, ...this.unitPatterns]) {
                pattern.lastIndex = 0;
                let m;
                while ((m = pattern.exec(text)) !== null) {
                    if (!m[0]) {
                        pattern.lastIndex++;
                        continue;
                    }
                    const span = { start: m.index, end: m.index + m[0].length };
                    if (!spans.some((s) => s.start < span.end && span.start < s.end)) {
                        spans.push({ ...span, kind: 'keep', label: m[0], output: m[0] });
                    }
                }
            }
        }
        if (!spans.length) return null;

        spans.sort((a, b) => a.start - b.start);
        const slots = [];
        let protectedText = '';
        let pos = 0;
        spans.forEach((span, idx) => {
            const id = idx + 1;
            protectedText += `${text.slice(pos, span.start)}[[${id}]]`;
            slots.push({ id, kind: span.kind, label: span.label, output: span.output });
            pos = span.end;
        });
        protectedText += text.slice(pos);

        const leftover = protectedText.replace(PLACEHOLDER_PATTERN, '');
        return {
            text: protectedText,
            slots,
            resolved: !/\p{L}/u.test(leftover),
            summary: this.summarize(slots)
        };
    }

    resolveLabelType(text, labelType = DEFAULT_LABEL_TYPE) {
        const key = normalizeLabelType(labelType);
        return key === 'auto' ? this.detectLabelType(text) : key;
    }

    detectLabelType(text) {
        if (!text || !this.load()) return 'general';

        let rest = text;
        const statements = this._scan(['statements'], tokenize(text), text, () => true);
        for (const span of statements.reverse()) {
            rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
        }
        const tokens = tokenize(rest);
        const names = (sets, accept) => new Set(this._scan(sets, tokens, rest, accept).map((s) => s.source.toLowerCase()));
        const foodNames = names(['food'], () => true);
        const cosmeticNames = names(['cosmetic'], (entry, source) => this._applies(entry, source));
        const distinct = (pattern) => new Set((rest.match(pattern) || []).map((m) => m.toLowerCase().replace(/\s+/g, ''))).size;
        const onlyIn = (own, other, skip = new Set()) => [...own].filter((n) => !other.has(n) && !skip.has(n)).length;

        const food = 2 * distinct(E_NUMBER) + 2 * onlyIn(foodNames, cosmeticNames)
            + Math.min(3, distinct(FOOD_CUES));
        const cosmetic = 2 * distinct(COLOUR_INDEX) + 2 * onlyIn(cosmeticNames, foodNames, EVERYDAY_INCI)
            + Math.min(3, distinct(COSMETIC_CUES));

        if (food >= 2 && food > cosmetic) return 'food';
        if (cosmetic >= 2 && cosmetic > food) return 'cosmetic';
        return 'general';
    }

    _phraseSpans(text, lang, sets) {
        const lists = ['statements', 'food', 'cosmetic'].filter((name) => sets.includes(name));
        return this._scan(lists, tokenize(text), text, (entry, source) => this._applies(entry, source, lang))
            .map(({ start, end, entry, source }) => ({
                start,
                end,
                kind: entry.kind,
                label: entry.kind === 'official' ? entry.label : source,
                output: entry.kind === 'official'
                    ? matchCase(source, stripTrailing(entry.targets[lang], entry.trailing), lang)
                    : source
            }));
    }

    _scan(lists, tokens, text, accept) {
        const tries = lists.map((name) => this.tries[name]).filter(Boolean);
        const spans = [];
        if (!tries.length) return spans;

        let i = 0;
        while (i < tokens.length) {
            let best = null;
            for (const trie of tries) {
                let node = trie.root;
                for (let j = i; j < tokens.length; j++) {
                    node = node.next.get(tokens[j].key);
                    if (!node) break;
                    if (!node.entries.length || (best && j <= best.last)) continue;
                    const source = text.slice(tokens[i].start, tokens[j].end);
                    const entry = node.entries.find((e) => accept(e, source));
                    if (entry) best = { last: j, entry, source };
                }
            }

            if (!best) {
                i++;
                continue;
            }
            spans.push({ start: tokens[i].start, end: tokens[best.last].end, entry: best.entry, source: best.source });
            i = best.last + 1;
        }
        return spans;
    }

    _applies(entry, source, lang) {
        if (entry.kind === 'official') return Boolean(entry.targets[lang]);
        if (entry.constraint === 'upper') return isAllUpper(source);
        if (entry.constraint === 'notLower') return !isAllLower(source);
        return true;
    }

    restore(translated, slots) {
        const byId = new Map(slots.map((slot) => [slot.id, slot]));
        const seen = new Map();
        let broken = false;
        const restored = translated.replace(PLACEHOLDER_PATTERN, (match, n) => {
            const slot = byId.get(Number(n));
            if (!slot) {
                broken = true;
                return match;
            }
            seen.set(slot.id, (seen.get(slot.id) || 0) + 1);
            return slot.output;
        });
        if (broken || seen.size !== slots.length || [...seen.values()].some((count) => count !== 1)) {
            return null;
        }
        return restored;
    }

    summarize(slots) {
        const unique = (kind) => [...new Set(slots.filter((s) => s.kind === kind).map((s) => s.label))];
        const official = unique('official');
        return { official, kept: unique('keep').filter((label) => !official.includes(label)) };
    }
}

const terminology = new Terminology();

module.exports = {
    Terminology,
    terminology,
    LABEL_TYPES,
    DEFAULT_LABEL_TYPE,
    normalizeLabelType,
    parseCsv,
    tokenize
};
