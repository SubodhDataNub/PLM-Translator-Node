'use strict';

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

function intFromEnv(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

const DEFAULT_MODEL = 'general/translation-llm';

class GoogleTranslateConfig {
    static load() {
        let credentials = null;
        if (process.env.GOOGLE_CREDENTIALS_JSON) {
            try {
                credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            } catch (e) {
                console.error(`GOOGLE_CREDENTIALS_JSON is not valid JSON: ${e.message}`);
            }
        }

        const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || null;
        const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID
            || process.env.GOOGLE_CLOUD_PROJECT
            || (credentials && credentials.project_id)
            || null;

        let edition = null;
        if (projectId) {
            edition = 'advanced';
        } else if (apiKey) {
            edition = 'basic';
        }

        return {
            edition,
            apiKey,
            projectId,
            location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
            credentials,
            model: process.env.GOOGLE_TRANSLATE_MODEL || DEFAULT_MODEL,
            maxCharsPerRequest: intFromEnv('TRANSLATE_MAX_CHARS_PER_REQUEST', 5000),
            requestDelayMs: intFromEnv('TRANSLATE_REQUEST_DELAY_MS', 250),
            maxRetries: intFromEnv('TRANSLATE_MAX_RETRIES', 5)
        };
    }

    static isConfigured(cfg) {
        return Boolean(cfg && cfg.edition);
    }
}

module.exports = {
    ROOT_DIR,
    GoogleTranslateConfig,
    massTranslateBatchSize: intFromEnv('TRANSLATE_BATCH_SIZE', 25),
    maxUploadMb: intFromEnv('MAX_UPLOAD_MB', 200)
};
