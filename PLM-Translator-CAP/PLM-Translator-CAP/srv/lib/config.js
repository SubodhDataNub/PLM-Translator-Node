'use strict';

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

function intFromEnv(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

const DEFAULT_MODEL = 'general/translation-llm';

function parseCredentials(value, source) {
    const text = String(value || '').trim();
    if (!text) return null;
    try {
        return JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8'));
    } catch (e) {
        console.error(`${source} is not a valid service account key (raw or base64 JSON): ${e.message}`);
        return null;
    }
}

function envValues() {
    return {
        credentialsJson: process.env.GOOGLE_CREDENTIALS_JSON,
        apiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
        model: process.env.GOOGLE_TRANSLATE_MODEL
    };
}

class GoogleTranslateConfig {
    static load() {
        return GoogleTranslateConfig.build(envValues(), 'GOOGLE_CREDENTIALS_JSON');
    }

    static build(values, source = 'Service account key') {
        const credentials = parseCredentials(values.credentialsJson, source);
        const apiKey = values.apiKey || null;
        const projectId = values.projectId
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
            location: values.location || 'global',
            credentials,
            model: values.model || DEFAULT_MODEL,
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
