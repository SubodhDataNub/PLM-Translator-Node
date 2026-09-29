/**
 * Utility functions for DN Translator application.
 * Contains helper functions and common utilities.
 */
'use strict';

const os = require('os');

/** Get current user information for the application */
function getUserInfo() {
    try {
        // Get system user information
        const currentUser = os.userInfo().username;
        const computerName = os.hostname();

        // On Windows, try to get full name from environment
        let userDisplayName = currentUser;
        if (process.platform === 'win32') {
            const fullName = process.env.USERNAME || currentUser;
            if (fullName && fullName !== currentUser) {
                userDisplayName = fullName;
            }
        }

        let userInfo = `${userDisplayName}`;

        // Add computer info for local development
        if (!process.env.WEBSITE_SITE_NAME) { // Not on Azure
            userInfo += ` (${computerName})`;
        }

        return {
            user: userInfo,
            username: currentUser,
            computer: computerName
        };
    } catch (e) {
        // Fallback to a generic user
        return {
            user: 'Current User',
            username: 'unknown',
            computer: 'unknown',
            error: `Limited user info: ${e.message}`
        };
    }
}

/** Validate translation request data */
function validateTranslationRequest(data) {
    if (!data || typeof data !== 'object') {
        return [false, 'No data provided'];
    }

    const sourceText = String(data.text ?? '').trim();
    const targetLanguage = String(data.target_language ?? '').trim();

    if (!sourceText) {
        return [false, 'Please enter text to translate'];
    }

    if (!targetLanguage) {
        return [false, 'Please select a target language'];
    }

    if (sourceText.length > 5000) {
        return [false, 'Text is too long. Maximum 5000 characters allowed.'];
    }

    return [true, null];
}

/**
 * Parse an accuracy value the way Python's float() did.
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

/** Validate test result data before saving */
function validateTestResultData(data) {
    if (!data) {
        return [false, 'No data provided', null];
    }

    // Validate required fields
    if (!data.outcome) {
        return [false, 'Outcome is required', null];
    }

    // Validate accuracy field
    if (!data.accuracy) {
        return [false, 'Accuracy is required', null];
    }

    return parseAccuracy(data.accuracy);
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
 * If input already looks like 'code-Name' return as-is. Otherwise try to find the display
 * name from the supported languages and return 'code-DisplayName'.
 */
function formatTargetLanguage(codeOrDisplay, languages) {
    try {
        if (!codeOrDisplay) {
            return '';
        }

        // Resolve name from supported languages (handles hyphenated codes such as 'zh-CN')
        const match = (languages || []).find((lang) => lang.key && lang.key === codeOrDisplay);
        if (match) {
            return `${codeOrDisplay}-${match.text || codeOrDisplay}`;
        }

        // Already in code-Name form, or unknown code: return as provided
        return codeOrDisplay;
    } catch (e) {
        return codeOrDisplay;
    }
}

/** Format a date as 'YYYYmmdd_HHMMSS' in local time (Python's strftime('%Y%m%d_%H%M%S')) */
function timestampForFilename(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Minimal strftime supporting %Y %m %d %H %M %S (UTC, matching stored timestamps) */
function strftime(date, format) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const parts = {
        Y: String(d.getUTCFullYear()),
        m: pad(d.getUTCMonth() + 1),
        d: pad(d.getUTCDate()),
        H: pad(d.getUTCHours()),
        M: pad(d.getUTCMinutes()),
        S: pad(d.getUTCSeconds()),
        '%': '%'
    };
    return format.replace(/%([YmdHMS%])/g, (_, key) => parts[key]);
}

/** Minimal printf-style formatter supporting %s, %d, %f and %.Nf (Jinja's "fmt"|format(value)) */
function printf(format, ...args) {
    let i = 0;
    return String(format).replace(/%(\.(\d+))?([sdif%])/g, (match, _p, precision, type) => {
        if (type === '%') return '%';
        const value = args[i++];
        if (type === 's') return String(value);
        const num = Number(value);
        if (type === 'd' || type === 'i') return String(Math.trunc(num));
        return num.toFixed(precision === undefined ? 6 : parseInt(precision, 10));
    });
}

/** Round like Python's round(value, digits) for display purposes */
function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

module.exports = {
    getUserInfo,
    validateTranslationRequest,
    validateTestResultData,
    parseAccuracy,
    parseLanguageCode,
    formatTargetLanguage,
    timestampForFilename,
    strftime,
    printf,
    round
};
