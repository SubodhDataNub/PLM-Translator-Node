'use strict';

const os = require('os');

function getUserInfo() {
    try {
        const username = os.userInfo().username;
        const computer = os.hostname();
        return { user: `${username} (${computer})`, username, computer };
    } catch (e) {
        return { user: 'Current User', username: 'unknown', computer: 'unknown' };
    }
}

function validateTranslationInput(text, targetLanguage) {
    if (!text) return 'Please enter text to translate';
    if (!targetLanguage) return 'Please select a target language';
    if (text.length > 5000) return 'Text is too long. Maximum 5000 characters allowed.';
    return null;
}

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

function formatTargetLanguage(codeOrDisplay, languages) {
    if (!codeOrDisplay) return '';
    const match = (languages || []).find((lang) => lang.key && lang.key === codeOrDisplay);
    return match ? `${codeOrDisplay}-${match.text || codeOrDisplay}` : codeOrDisplay;
}

function timestampForFilename(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatDateTime(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

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
