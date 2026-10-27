'use strict';

const { GoogleTranslateConfig } = require('./config');
const { terminology, normalizeLabelType } = require('./terminology');
const { DESTINATION_NAME, hasDestinationService, readGoogleDestination } = require('./google-destination');

const DESTINATION_REFRESH_MS = 10 * 60 * 1000;
const DESTINATION_RETRY_MS = 60 * 1000;

const V2_BASE_URL = 'https://translation.googleapis.com/language/translate/v2';

const MAX_SEGMENTS_PER_REQUEST = { basic: 128, advanced: 1024 };

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
        this._v3Client = null;
        this.modelUnsupportedTargets = new Set();
        this.configSource = 'environment';
        this._destinationNextCheck = 0;
        this._destinationLoading = null;
    }

    async ensureConfig() {
        if (!hasDestinationService() || Date.now() < this._destinationNextCheck) return;
        if (!this._destinationLoading) {
            this._destinationLoading = this._loadFromDestination().finally(() => {
                this._destinationLoading = null;
            });
        }
        await this._destinationLoading;
    }

    async _loadFromDestination() {
        try {
            const values = await readGoogleDestination();
            this._applyConfig(GoogleTranslateConfig.build(values, `Destination ${DESTINATION_NAME}`));
            this.configSource = `destination ${DESTINATION_NAME}`;
            this._destinationNextCheck = Date.now() + DESTINATION_REFRESH_MS;
        } catch (e) {
            console.error(`Could not read Google settings from destination ${DESTINATION_NAME}: ${e.message}`);
            this._destinationNextCheck = Date.now() + DESTINATION_RETRY_MS;
        }
    }

    _applyConfig(cfg) {
        const fingerprint = (c) => JSON.stringify([c.edition, c.apiKey, c.projectId, c.location, c.model, c.credentials]);
        if (fingerprint(cfg) === fingerprint(this.config)) return;
        this.config = cfg;
        this._v3Client = null;
        this.languagesCache = null;
        this.languagesFailedAt = 0;
        this.modelUnsupportedTargets.clear();
    }

    isConfigured() {
        return GoogleTranslateConfig.isConfigured(this.config);
    }

    get edition() {
        return this.config.edition;
    }

    async getSupportedLanguages() {
        await this.ensureConfig();
        if (this.languagesCache) {
            return this.languagesCache;
        }

        if (!this.isConfigured() || Date.now() - this.languagesFailedAt < LANGUAGES_RETRY_INTERVAL_MS) {
            return this._getFallbackLanguages();
        }

        try {
            const apiLanguages = this.edition === 'advanced'
                ? await this._fetchLanguagesV3()
                : await this._fetchLanguagesV2();

            if (!apiLanguages.length) {
                throw new Error('Invalid API response structure');
            }

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
        const url = `${V2_BASE_URL}/languages?target=en`;
        const response = await fetch(url, {
            headers: { 'X-Goog-Api-Key': this.config.apiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(10000)
        });
        const data = await this._parseV2Response(response);
        return ((data.data && data.data.languages) || []).map((lang) => ({
            code: lang.language,
            name: lang.name
        }));
    }

    async _fetchLanguagesV3() {
        const [response] = await this._getV3Client().getSupportedLanguages(
            { parent: this._v3Parent(), displayLanguageCode: 'en' },
            { timeout: 10000 }
        );
        return (response.languages || [])
            .filter((lang) => lang.supportTarget)
            .map((lang) => ({ code: lang.languageCode, name: lang.displayName }));
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
        await this.ensureConfig();
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'Google Cloud Translation service is not configured. Please set the required environment variables.'
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
        await this.ensureConfig();
        if (!this.isConfigured()) {
            return texts.map((text) => ({
                success: false,
                error: 'Google Cloud Translation service is not configured.',
                translated_text: '',
                original_text: text
            }));
        }

        if (!texts || texts.length === 0) {
            return [];
        }

        const { requestDelayMs, maxRetries } = this.config;
        const batches = this._makeBatches(texts, maxBatchSize);
        const allResults = [];

        console.log(`Processing ${texts.length} texts in ${batches.length} batches of up to ${maxBatchSize} texts each`);

        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const batchNum = b + 1;
            const charCount = batch.reduce((sum, text) => sum + text.length, 0);
            console.log(`Batch ${batchNum}/${batches.length}: ${batch.length} texts, ${charCount} characters`);

            if (b > 0 && requestDelayMs > 0) {
                await sleep(requestDelayMs);
            }

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
        const maxItems = Math.max(1, Math.min(maxBatchSize, MAX_SEGMENTS_PER_REQUEST[this.edition] || 128));
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

        const translations = await this._sendTranslations(
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
            const plain = await this._sendTranslations(damaged.map((idx) => texts[idx]), targetLanguage, timeoutMs);
            damaged.forEach((idx, k) => {
                results[idx] = plain[k] && { ...plain[k], terminology: { official: [], kept: [], skipped: true } };
            });
        }
        return this._withLabelTypes(results, labelTypes);
    }

    _withLabelTypes(results, labelTypes) {
        return results.map((result, idx) => result && { ...result, labelType: labelTypes[idx] });
    }

    async _sendTranslations(texts, targetLanguage, timeoutMs) {
        return this.edition === 'advanced'
            ? this._translateV3(texts, targetLanguage, timeoutMs)
            : this._translateV2(texts, targetLanguage, timeoutMs);
    }

    async _translateV2(texts, targetLanguage, timeoutMs) {
        const body = { q: texts, target: targetLanguage, format: 'text' };
        if (/^(nmt|base)$/.test(this.config.model || '')) body.model = this.config.model;

        let response;
        try {
            response = await fetch(V2_BASE_URL, {
                method: 'POST',
                headers: {
                    'X-Goog-Api-Key': this.config.apiKey,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (e) {
            if (e.name === 'TimeoutError' || e.name === 'AbortError') {
                throw new TranslationError('Request timed out', { timeout: true });
            }
            throw new TranslationError(e.message, { retryable: true });
        }

        const data = await this._parseV2Response(response);
        const translations = (data.data && data.data.translations) || [];
        return translations.map((t) => ({
            translatedText: t.translatedText,
            detectedLanguage: t.detectedSourceLanguage || null
        }));
    }

    async _parseV2Response(response) {
        let data = null;
        try {
            data = await response.json();
        } catch (e) {
        }

        if (!response.ok) {
            const apiError = (data && data.error) || {};
            const reasons = (apiError.errors || []).map((err) => err.reason);
            const rateLimited = response.status === 429
                || reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(r || ''));
            throw new TranslationError(
                `${response.status} ${apiError.message || response.statusText}`,
                { status: response.status, rateLimited, retryable: response.status === 503 }
            );
        }
        return data || {};
    }

    async _translateV3(texts, targetLanguage, timeoutMs) {
        const request = {
            parent: this._v3Parent(),
            contents: texts,
            mimeType: 'text/plain',
            targetLanguageCode: targetLanguage
        };
        const useModel = Boolean(this.config.model) && !this.modelUnsupportedTargets.has(targetLanguage);
        if (useModel) request.model = this._v3ModelPath();

        try {
            const [response] = await this._getV3Client().translateText(request, { timeout: timeoutMs });
            return (response.translations || []).map((t) => ({
                translatedText: t.translatedText,
                detectedLanguage: t.detectedLanguageCode || null
            }));
        } catch (e) {
            if (useModel && e.code === 3 && /unsupported language pair/i.test(e.details || e.message || '')) {
                console.log(`Model ${this.config.model} does not support '${targetLanguage}' - using the standard model instead`);
                this.modelUnsupportedTargets.add(targetLanguage);
                return this._translateV3(texts, targetLanguage, timeoutMs);
            }
            if (e.code === 4) {
                throw new TranslationError('Request timed out', { timeout: true });
            }
            throw new TranslationError(e.details || e.message, {
                status: e.code,
                rateLimited: e.code === 8,
                retryable: e.code === 14
            });
        }
    }

    _getV3Client() {
        if (!this._v3Client) {
            const { TranslationServiceClient } = require('@google-cloud/translate').v3;
            const options = { projectId: this.config.projectId };
            if (this.config.credentials) {
                options.credentials = this.config.credentials;
            }
            this._v3Client = new TranslationServiceClient(options);
        }
        return this._v3Client;
    }

    _v3Parent() {
        return `projects/${this.config.projectId}/locations/${this.config.location}`;
    }

    _v3ModelPath() {
        const model = this.config.model;
        return model.startsWith('projects/') ? model : `${this._v3Parent()}/models/${model}`;
    }
}

const translatorService = new TranslatorService();

module.exports = { TranslatorService, TranslationError, translatorService };
