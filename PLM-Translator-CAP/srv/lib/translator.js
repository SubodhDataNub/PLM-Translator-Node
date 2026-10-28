'use strict';

const { GoogleTranslateConfig } = require('./config');
const { terminology, normalizeLabelType } = require('./terminology');
const { DESTINATION_NAME, hasDestinationService } = require('./google-destination');

const MAX_ITEMS_PER_REQUEST = 128;

const LANGUAGES_RETRY_INTERVAL_MS = 60 * 1000;

const LANGUAGE_ALIASES = { zh: 'zh-CN', iw: 'he', jw: 'jv', tl: 'fil' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class TranslationError extends Error {
    constructor(message, { status = null, retryable = false, rateLimited = false, timeout = false } = {}) {
        super(message);
        this.name = 'TranslationError';
        this.status = status;
        this.retryable = retryable || rateLimited;
        this.rateLimited = rateLimited;
        this.timeout = timeout;
    }
}

class TranslatorService {
    constructor(cfg = GoogleTranslateConfig.load()) {
        this.config = cfg;
        this.languagesCache = null;
        this.languagesFailedAt = 0;
    }

    isConfigured() {
        return hasDestinationService();
    }

    _apiKeyHeaders() {
        const key = process.env.GOOGLE_TRANSLATE_API_KEY;
        return key ? { 'X-Goog-Api-Key': key } : {};
    }

    async getSupportedLanguages() {
        if (this.languagesCache) return this.languagesCache;

        if (!this.isConfigured() || Date.now() - this.languagesFailedAt < LANGUAGES_RETRY_INTERVAL_MS) {
            return this._getFallbackLanguages();
        }

        try {
            const apiLanguages = await this._fetchLanguagesV2();
            if (!apiLanguages.length) throw new Error('Invalid API response structure');

            const codes = new Set(apiLanguages.map((lang) => lang.code));
            const languages = apiLanguages
                .filter(({ code }) => !(LANGUAGE_ALIASES[code] && codes.has(LANGUAGE_ALIASES[code])))
                .map(({ code, name }) => ({ key: code, text: name || code }))
                .sort((a, b) => a.text.localeCompare(b.text));
            languages.unshift({ key: '', text: 'Select Target Language' });

            this.languagesCache = languages;
            return languages;
        } catch (e) {
            console.error(`Failed to load supported languages from Google: ${e.message}`);
            this.languagesFailedAt = Date.now();
            return this._getFallbackLanguages();
        }
    }

    async _fetchLanguagesV2() {
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
        const response = await executeHttpRequest(
            { destinationName: DESTINATION_NAME },
            { method: 'GET', url: '/language/translate/v2/languages', params: { target: 'en' }, timeout: 10000, headers: this._apiKeyHeaders() },
            { fetchCsrfToken: false }
        );
        return ((response.data && response.data.data && response.data.data.languages) || []).map((lang) => ({
            code: lang.language,
            name: lang.name
        }));
    }

    _getFallbackLanguages() {
        return [
            { key: '', text: 'Select Target Language' },
            { key: 'ar', text: 'Arabic' },
            { key: 'zh-CN', text: 'Chinese (Simplified)' },
            { key: 'zh-TW', text: 'Chinese (Traditional)' },
            { key: 'da', text: 'Danish' },
            { key: 'nl', text: 'Dutch' },
            { key: 'fi', text: 'Finnish' },
            { key: 'fr', text: 'French' },
            { key: 'de', text: 'German' },
            { key: 'hi', text: 'Hindi' },
            { key: 'id', text: 'Indonesian' },
            { key: 'it', text: 'Italian' },
            { key: 'ja', text: 'Japanese' },
            { key: 'ko', text: 'Korean' },
            { key: 'no', text: 'Norwegian' },
            { key: 'pl', text: 'Polish' },
            { key: 'pt', text: 'Portuguese' },
            { key: 'ru', text: 'Russian' },
            { key: 'es', text: 'Spanish' },
            { key: 'sv', text: 'Swedish' },
            { key: 'th', text: 'Thai' },
            { key: 'tr', text: 'Turkish' }
        ];
    }

    async translateText(text, targetLanguage, { labelType } = {}) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Google Cloud Translation service is not configured. Please set GOOGLE_TRANSLATE_API_KEY or configure the BTP destination.'
            };
        }

        try {
            const [result] = await this._requestTranslations([text], targetLanguage, 30000, { labelType });
            if (!result || typeof result.translatedText !== 'string') {
                throw new Error('Invalid translation response');
            }
            return {
                success: true,
                translated_text: result.translatedText,
                source_language: result.detectedLanguage || 'auto',
                target_language: targetLanguage,
                label_type: result.labelType || normalizeLabelType(labelType),
                label_type_detected: normalizeLabelType(labelType) === 'auto',
                terminology: result.terminology || null
            };
        } catch (e) {
            if (e.timeout) {
                return { success: false, error: 'Translation request timed out. Please try again.' };
            }
            if (e instanceof TranslationError) {
                return { success: false, error: `Translation service error: ${e.message}` };
            }
            return { success: false, error: `Translation failed: ${e.message}` };
        }
    }

    async translateBatch(texts, targetLanguage, maxBatchSize = 50, { labelType } = {}) {
        if (!this.isConfigured()) {
            return texts.map((text) => ({
                success: false,
                error: 'Google Cloud Translation service is not configured.',
                translated_text: '',
                original_text: text
            }));
        }

        if (!texts || texts.length === 0) return [];

        const { requestDelayMs, maxRetries } = this.config;
        const batches = this._makeBatches(texts, maxBatchSize);
        const allResults = [];

        console.log(`Processing ${texts.length} texts in ${batches.length} batches of up to ${maxBatchSize} texts each`);

        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const batchNum = b + 1;
            const charCount = batch.reduce((sum, text) => sum + text.length, 0);
            console.log(`Batch ${batchNum}/${batches.length}: ${batch.length} texts, ${charCount} characters`);

            if (b > 0 && requestDelayMs > 0) await sleep(requestDelayMs);

            let retryCount = 0;
            while (true) {
                try {
                    const translations = await this._requestTranslations(batch, targetLanguage, 60000, { labelType });
                    batch.forEach((text, idx) => {
                        const translation = translations[idx];
                        if (translation && typeof translation.translatedText === 'string') {
                            allResults.push({
                                success: true,
                                translated_text: translation.translatedText,
                                source_language: translation.detectedLanguage || 'auto',
                                target_language: targetLanguage,
                                original_text: text,
                                label_type: translation.labelType || null,
                                terminology: translation.terminology || null
                            });
                        } else {
                            allResults.push({
                                success: false,
                                error: 'Invalid translation response',
                                translated_text: '',
                                original_text: text
                            });
                        }
                    });
                    console.log(`Batch ${batchNum}/${batches.length} completed successfully`);
                    break;
                } catch (e) {
                    if (e.retryable && retryCount + 1 < maxRetries) {
                        retryCount += 1;
                        const waitTime = 5 * (2 ** (retryCount - 1));
                        const reason = e.rateLimited ? 'Rate limit hit!' : `Transient error (${e.message}).`;
                        console.log(`${reason} Retry ${retryCount}/${maxRetries} after ${waitTime} seconds...`);
                        await sleep(waitTime * 1000);
                        continue;
                    }

                    let error;
                    if (e.timeout) {
                        console.log(`Timeout error for batch ${batchNum}`);
                        error = 'Translation request timed out';
                    } else if (e.rateLimited) {
                        console.log(`Max retries reached for batch ${batchNum}. Marking as failed.`);
                        error = 'Rate limit exceeded after multiple retries. Please reduce batch size or wait before retrying.';
                    } else {
                        console.log(`Request error for batch ${batchNum}: ${e.message}`);
                        error = `Translation service error: ${e.message}`;
                    }
                    for (const text of batch) {
                        allResults.push({ success: false, error, translated_text: '', original_text: text });
                    }
                    break;
                }
            }
        }

        return allResults;
    }

    _makeBatches(texts, maxBatchSize) {
        const maxItems = Math.max(1, Math.min(maxBatchSize, MAX_ITEMS_PER_REQUEST));
        const maxChars = Math.max(1, this.config.maxCharsPerRequest);
        const batches = [];
        let current = [];
        let currentChars = 0;

        for (const text of texts) {
            const length = text.length;
            if (current.length > 0 && (current.length >= maxItems || currentChars + length > maxChars)) {
                batches.push(current);
                current = [];
                currentChars = 0;
            }
            current.push(text);
            currentChars += length;
        }
        if (current.length > 0) batches.push(current);
        return batches;
    }

    async _requestTranslations(texts, targetLanguage, timeoutMs, { labelType } = {}) {
        const labelTypes = texts.map((text) => terminology.resolveLabelType(text, labelType));
        const prepared = texts.map((text, idx) => terminology.protect(text, targetLanguage, labelTypes[idx]));
        const results = new Array(texts.length);
        const pending = [];

        prepared.forEach((p, idx) => {
            if (p && p.resolved) {
                results[idx] = {
                    translatedText: terminology.restore(p.text, p.slots),
                    detectedLanguage: p.summary.official.length ? 'en' : null,
                    terminology: p.summary
                };
            } else {
                pending.push(idx);
            }
        });
        if (!pending.length) return this._withLabelTypes(results, labelTypes);

        const translations = await this._translateV2(
            pending.map((idx) => (prepared[idx] ? prepared[idx].text : texts[idx])),
            targetLanguage,
            timeoutMs
        );

        const damaged = [];
        pending.forEach((idx, k) => {
            const translation = translations[k];
            const p = prepared[idx];
            if (!p || !translation || typeof translation.translatedText !== 'string') {
                results[idx] = translation;
                return;
            }
            const restored = terminology.restore(translation.translatedText, p.slots);
            if (restored === null) {
                damaged.push(idx);
            } else {
                results[idx] = { ...translation, translatedText: restored, terminology: p.summary };
            }
        });

        if (damaged.length) {
            console.warn(`Translator changed terminology placeholders in ${damaged.length} text(s) for '${targetLanguage}' - translating them again without terminology`);
            const plain = await this._translateV2(damaged.map((idx) => texts[idx]), targetLanguage, timeoutMs);
            damaged.forEach((idx, k) => {
                results[idx] = plain[k] && { ...plain[k], terminology: { official: [], kept: [], skipped: true } };
            });
        }
        return this._withLabelTypes(results, labelTypes);
    }

    _withLabelTypes(results, labelTypes) {
        return results.map((result, idx) => result && { ...result, labelType: labelTypes[idx] });
    }

    async _translateV2(texts, targetLanguage, timeoutMs) {
        const body = { q: texts, target: targetLanguage, format: 'text', model: 'nmt' };

        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
        try {
            const response = await executeHttpRequest(
                { destinationName: DESTINATION_NAME },
                { method: 'POST', url: '/language/translate/v2', data: body, timeout: timeoutMs, headers: this._apiKeyHeaders() },
                { fetchCsrfToken: false }
            );
            const translations = (response.data && response.data.data && response.data.data.translations) || [];
            return translations.map((t) => ({
                translatedText: t.translatedText,
                detectedLanguage: t.detectedSourceLanguage || null
            }));
        } catch (e) {
            if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '')) {
                throw new TranslationError('Request timed out', { timeout: true });
            }
            const status = e.response && e.response.status;
            const apiError = (e.response && e.response.data && e.response.data.error) || {};
            const reasons = (apiError.errors || []).map((err) => err.reason);
            const rateLimited = status === 429
                || reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(r || ''));
            throw new TranslationError(
                `${status || ''} ${apiError.message || e.message}`.trim(),
                { status, rateLimited, retryable: status === 503 }
            );
        }
    }

}

const translatorService = new TranslatorService();

module.exports = { TranslatorService, TranslationError, translatorService };
