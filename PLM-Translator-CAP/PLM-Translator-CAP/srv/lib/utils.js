/**
 * Utility functions for DN Translator (ported from the Node.js version's utils.js).
 */
'use strict';

const os = require('os');

/** Current user information (the OS account, as in the Node.js version) */
function getUserInfo() {
    try {
        const username = os.userInfo().username;
        const computer = os.hostname();
        return { user: `${username} (${computer})`, username, computer };
    } catch (e) {
        return { user: 'Current User', username: 'unknown', computer: 'unknown' };
    }
}

/**
 * Validate translation input.
 * @returns {string|null} error message, or null when valid
 */
function validateTranslationInput(text, targetLanguage) {
    if (!text) return 'Please enter text to translate';
    if (!targetLanguage) return 'Please select a target language';
    if (text.length > 5000) return 'Text is too long. Maximum 5000 characters allowed.';
    return null;
}

/**
 * Parse an accuracy value.
 * @returns {[boolean, string|null, number|null]} [valid, error, accuracy]
 */
function parseAccuracy(value) {
    const accuracy = (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== ''
        ? Number(value)
        : NaN;
    if (!Number.isFinite(accuracy)) {
        return [false, 'Accuracy must be a valid number', null];
    }
    if (accuracy < 0 || accuracy > 100) {
        return [false, 'Accuracy must be between 0 and 100', null];
    }
    return [true, null, accuracy];
}

/**
 * Find the language code at the start of a stored target language value.
 * Stored values look like 'code-Name' (e.g. 'fr-French', 'zh-CN-Chinese (Simplified)'),
 * and Google language codes can themselves contain hyphens, so match the longest known code.
 */
function parseLanguageCode(value, languages) {
    if (!value) return '';
    let best = '';
    for (const lang of languages || []) {
        const key = lang.key;
        if (key && key.length > best.length && (value === key || value.startsWith(`${key}-`))) {
            best = key;
        }
    }
    return best || value.split('-')[0];
}

/**
 * Return target language in 'code-Name' format.
 * A known code becomes 'code-DisplayName'; anything else (already 'code-Name') is returned as-is.
 */
function formatTargetLanguage(codeOrDisplay, languages) {
    if (!codeOrDisplay) return '';
    const match = (languages || []).find((lang) => lang.key && lang.key === codeOrDisplay);
    return match ? `${codeOrDisplay}-${match.text || codeOrDisplay}` : codeOrDisplay;
}

/** Format a date as 'YYYYmmdd_HHMMSS' in local time */
function timestampForFilename(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Format a timestamp as 'YYYY-MM-DD HH:MM:SS' (UTC, matching stored timestamps) */
function formatDateTime(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Round like Python's round(value, digits) for display purposes */
function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

module.exports = {
    getUserInfo,
    validateTranslationInput,
    parseAccuracy,
    parseLanguageCode,
    formatTargetLanguage,
    timestampForFilename,
    formatDateTime,
    round
};
