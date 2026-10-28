'use strict';

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

function intFromEnv(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

class GoogleTranslateConfig {
    static load() {
        return {
            maxCharsPerRequest: intFromEnv('TRANSLATE_MAX_CHARS_PER_REQUEST', 5000),
            requestDelayMs: intFromEnv('TRANSLATE_REQUEST_DELAY_MS', 250),
            maxRetries: intFromEnv('TRANSLATE_MAX_RETRIES', 5)
        };
    }
}

module.exports = {
    ROOT_DIR,
    GoogleTranslateConfig,
    massTranslateBatchSize: intFromEnv('TRANSLATE_BATCH_SIZE', 25),
    maxUploadMb: intFromEnv('MAX_UPLOAD_MB', 200)
};
