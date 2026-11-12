'use strict';

const cds = require('@sap/cds');
const crypto = require('crypto');
const { Readable } = require('stream');
const config = require('./lib/config');
const { translatorService } = require('./lib/translator');
const { normalizeLabelType } = require('./lib/terminology');
const { XLSX_MIME, readSpreadsheet, workbookToBuffer } = require('./lib/excel');
const mass = require('./lib/mass-translation');
const {
    getUserInfo, parseAccuracy, parseLanguageCode, formatTargetLanguage, timestampForFilename, round
} = require('./lib/utils');

const LOG = cds.log('translator');
const INSERT_CHUNK_SIZE = 500;
const MAX_CHARS = 5000;
const LABEL_TYPE_NAMES = { general: 'General', food: 'Food', cosmetic: 'Cosmetic or detergent' };

const isXsuaa = () => Boolean(cds.env.requires.auth && cds.env.requires.auth.kind === 'xsuaa');
const userId = (req) => (req.user && req.user.id) || 'anonymous';
const isFailure = (outcome) => mass.isFailureOutcome(outcome) || outcome === 'Failed';

function truncate(value, max) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function defaultTestedBy(req) {
    return truncate(isXsuaa() ? userId(req) : getUserInfo().user, 100);
}

async function toBuffer(value) {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Readable) {
        const chunks = [];
        for await (const chunk of value) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }
    return Buffer.from(value);
}

function uploadFileName(headers = {}) {
    const disposition = headers['content-disposition'] || '';
    const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
    if (encoded) return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    if (plain) return decodeURIComponent(plain[1].trim());
    if (headers.slug) return decodeURIComponent(headers.slug);
    return null;
}

function terminologyNote(terminology, labelType) {
    const parts = [];
    if (LABEL_TYPE_NAMES[labelType]) parts.push(`Label type: ${LABEL_TYPE_NAMES[labelType]}`);
    if (terminology && terminology.skipped) {
        parts.push('Label terminology could not be applied to this text, so it was translated without it.');
    } else if (terminology) {
        if (terminology.official && terminology.official.length) {
            parts.push(`Official wording: ${terminology.official.join(', ')}`);
        }
        if (terminology.kept && terminology.kept.length) {
            parts.push(`Kept as written: ${terminology.kept.join(', ')}`);
        }
    }
    return truncate(parts.join(' · '), 1000) || null;
}

function formatEstimate(totalRows, languageCount) {
    if (!totalRows || !languageCount) return null;
    const { estimatedMinutes, estimatedHours } = mass.estimateProcessingTime(totalRows, languageCount);
    const total = (totalRows * languageCount).toLocaleString('en');
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    const time = estimatedHours >= 1 ? `${estimatedHours.toFixed(1)} hours`
        : estimatedMinutes >= 1 ? plural(Math.round(estimatedMinutes), 'minute')
            : plural(Math.max(1, Math.round(estimatedMinutes * 60)), 'second');
    return `About ${time} for ${total} translations`;
}

module.exports = class TranslatorService extends cds.ApplicationService {
    init() {
        const { TestResults, MassTranslations, MassTranslationLanguages } = this.entities;
        const db = cds.entities('plm.translator');

        const insertResults = async (records) => {
            const rows = records.map((record) => ({ ID: cds.utils.uuid(), ...record }));
            for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
                await INSERT.into(db.TestResults).entries(rows.slice(i, i + INSERT_CHUNK_SIZE));
            }
            return rows;
        };

        const languageList = () => translatorService.getSupportedLanguages();

        const logActivity = async (req, action, fields = {}) => {
            try {
                await INSERT.into(db.ActivityLog).entries({
                    ...fields,
                    activity: action,
                    details: truncate(fields.details, 1000),
                    language: fields.language ? truncate(fields.language, 100) : null
                });
            } catch (e) {
                LOG.warn(`Could not record activity "${action}": ${e.message}`);
            }
        };

        // Single translation: a draft test result that is translated, reviewed and saved

        this.before('NEW', TestResults.drafts, (req) => {
            req.data.testedBy ??= defaultTestedBy(req);
        });

        this.before('UPDATE', TestResults.drafts, (req) => {
            if ('outcome' in req.data && isFailure(req.data.outcome)) req.data.accuracy = 0;
        });

        this.on('translateText', async (req) => {
            const draft = await SELECT.one.from(req.subject).columns('textToTranslate', 'targetLanguage');
            if (!draft) return req.reject(404, 'Test result not found');
            const text = String(draft.textToTranslate ?? '').trim();
            if (!text) return req.reject(400, 'Enter the text to translate first');
            if (text.length > MAX_CHARS) return req.reject(400, `Text is too long. Maximum ${MAX_CHARS} characters allowed.`);
            if (!draft.targetLanguage) return req.reject(400, 'Select a target language first');

            const languages = await languageList();
            const targetCode = parseLanguageCode(draft.targetLanguage, languages);
            const result = await translatorService.translateText(text, targetCode, { labelType: normalizeLabelType() });
            if (!result.success) return req.reject(502, result.error || 'Translation failed');

            const sourceLabel = formatTargetLanguage(result.source_language, languages);
            await UPDATE(req.subject).with({
                translatedText: result.translated_text,
                sourceLanguage: sourceLabel.length <= 20 ? sourceLabel : truncate(result.source_language, 20),
                terminologyNote: terminologyNote(result.terminology, result.label_type)
            });
            await logActivity(req, 'translate', { details: text, language: targetCode, itemCount: 1 });
        });

        this.before('CREATE', TestResults, async (req) => {
            const data = req.data;
            if (isXsuaa()) data.testedBy = truncate(userId(req), 100);
            if (!data.outcome) return req.reject(400, 'Outcome is required');
            if (data.outcome === 'Failed') data.outcome = 'Failure';
            if (!String(data.translatedText ?? '').trim()) {
                return req.reject(400, 'Translate the text before saving the result');
            }
            if (!String(data.testedBy ?? '').trim()) return req.reject(400, 'Tested by is required');

            if (data.accuracy === null || data.accuracy === undefined || data.accuracy === '') {
                if (isFailure(data.outcome)) data.accuracy = 0;
                else return req.reject(400, 'Accuracy is required unless the outcome is Failed');
            } else {
                const [valid, error, value] = parseAccuracy(data.accuracy);
                if (!valid) return req.reject(400, error);
                data.accuracy = value;
            }

            data.sourceLanguage ??= 'auto';
            data.targetLanguage = formatTargetLanguage(data.targetLanguage, await languageList());
        });

        this.after('CREATE', TestResults, async (result, req) => {
            const data = req.data;
            await logActivity(req, 'save', {
                details: `Saved result (${data.outcome})`,
                language: data.targetLanguage,
                itemCount: 1,
                translation_ID: data.ID ?? result?.ID
            });
        });

        this.before('UPDATE', TestResults, (req) => {
            if ('accuracy' in req.data && req.data.accuracy !== null) {
                const [valid, error, value] = parseAccuracy(req.data.accuracy);
                if (!valid) return req.reject(400, error);
                req.data.accuracy = value;
            }
        });

        // Mass translation: a draft job with an uploaded Excel file and target languages

        this.before('NEW', MassTranslations.drafts, async (req) => {
            req.data.testedBy ??= defaultTestedBy(req);
            req.data.status = 'New';
            req.data.templateFileName = 'mass_translation_template.xlsx';
            req.data.templateFile = await workbookToBuffer(mass.templateWorkbook());
        });

        this.before('UPDATE', MassTranslations.drafts, async (req) => {
            if (!('file' in req.data)) return;
            const buffer = await toBuffer(req.data.file);
            if (!buffer || buffer.length === 0) {
                Object.assign(req.data, { file: null, fileName: null, mimeType: null, totalRows: null, textColumn: null });
                return;
            }
            if (buffer.length > config.maxUploadMb * 1024 * 1024) {
                return req.reject(413, `File is larger than ${config.maxUploadMb} MB`);
            }
            const headers = req.headers || {};
            const fileName = uploadFileName(headers) || 'upload.xlsx';
            if (!mass.isExcelFilename(fileName)) return req.reject(400, 'Please upload an Excel file (.xlsx or .xls)');

            let validation;
            try {
                validation = await mass.validateWorkbook(buffer);
            } catch (e) {
                return req.reject(400, `Error reading Excel file: ${e.message}`);
            }
            Object.assign(req.data, {
                file: buffer,
                fileName: truncate(fileName, 255),
                mimeType: String(headers['content-type'] || XLSX_MIME).split(';')[0],
                totalRows: validation.totalRows,
                textColumn: truncate(validation.textColumn, 255)
            });
        });

        const wantsEstimate = (req) => {
            const columns = req.query.SELECT && req.query.SELECT.columns;
            return !columns || columns.some((col) => col === '*' || (col.ref && col.ref[0] === 'estimatedTime'));
        };

        const addEstimates = async (rows, req, jobs, languages) => {
            if (!wantsEstimate(req)) return;
            const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
            for (const row of list) {
                if (!row || !row.ID) continue;
                const job = await SELECT.one.from(jobs).columns('totalRows').where({ ID: row.ID });
                const count = await SELECT.one.from(languages).columns('count(1) as n').where({ parent_ID: row.ID });
                row.estimatedTime = formatEstimate(job && job.totalRows, Number((count && count.n) || 0));
            }
        };

        const selects = (columns, name) => !columns || columns.some((col) => col === '*' || (col.ref && col.ref[0] === name));

        this.before('READ', MassTranslations, (req) => {
            const columns = req.query.SELECT && req.query.SELECT.columns;
            if (columns && selects(columns, 'editLocked') && !selects(columns, 'status')) columns.push({ ref: ['status'] });
        });

        this.after('READ', MassTranslations, async (rows, req) => {
            await addEstimates(rows, req, MassTranslations, MassTranslationLanguages);
            if (!selects(req.query.SELECT && req.query.SELECT.columns, 'editLocked')) return;
            for (const row of Array.isArray(rows) ? rows : [rows]) {
                if (row && row.status !== undefined) row.editLocked = Boolean(row.status) && row.status !== 'New';
            }
        });
        this.after('READ', MassTranslations.drafts,
            (rows, req) => addEstimates(rows, req, MassTranslations.drafts, MassTranslationLanguages.drafts));

        this.before('CREATE', MassTranslations, (req) => {
            if (isXsuaa()) req.data.testedBy = truncate(userId(req), 100);
            req.data.status = 'New';
        });

        this.before('EDIT', MassTranslations, async (req) => {
            const job = await SELECT.one.from(req.subject).columns('status');
            if (job && job.status !== 'New') {
                return req.reject(409, 'This mass translation has already run and can no longer be changed. Create a new one instead.');
            }
        });

        this.on('start', async (req) => {
            const job = await SELECT.one.from(req.subject).columns('ID', 'status', 'fileName', 'file', 'testedBy');
            if (!job) return req.reject(404, 'Mass translation not found');
            if (job.status !== 'New') return req.reject(409, 'This mass translation has already run');

            const buffer = await toBuffer(job.file);
            if (!buffer || buffer.length === 0) return req.reject(400, 'Upload an Excel file first');
            const languageRows = await SELECT.from(MassTranslationLanguages).columns('language').where({ parent_ID: job.ID });
            const targetLanguages = [...new Set(languageRows.map((row) => row.language).filter(Boolean))];
            if (targetLanguages.length === 0) return req.reject(400, 'Add at least one target language');
            const testedBy = isXsuaa() ? truncate(userId(req), 100) : String(job.testedBy || '').trim();
            if (!testedBy) return req.reject(400, 'Tested by is required');

            let table;
            try {
                table = await readSpreadsheet(buffer);
            } catch (e) {
                return req.reject(400, `Error reading Excel file: ${e.message}`);
            }
            if (table.columns.length === 0 || table.rows.length === 0) return req.reject(400, 'Excel file is empty');

            const totalRows = table.rows.length;
            const sessionId = `mass_translation_${timestampForFilename()}_${crypto.randomBytes(4).toString('hex')}`;
            const labelType = normalizeLabelType();
            const { textsData } = mass.collectTexts(table);
            const texts = textsData.map((item) => item.text);
            const languages = await languageList();
            const labelTypes = { general: 0, food: 0, cosmetic: 0 };
            const savedRows = [];
            let successful = 0;

            LOG.info(`Mass translation ${sessionId}: ${texts.length} texts × ${targetLanguages.length} languages`);

            for (const targetLanguage of targetLanguages) {
                const targetLanguageLabel = formatTargetLanguage(targetLanguage, languages);
                const results = await translatorService.translateBatch(
                    texts, targetLanguage, config.massTranslateBatchSize, { labelType }
                );

                if (targetLanguage === targetLanguages[0]) {
                    for (const result of results) {
                        if (result.label_type in labelTypes) labelTypes[result.label_type] += 1;
                    }
                }

                const records = results.map((result, idx) => {
                    const item = textsData[idx];
                    const base = {
                        accuracy: 0,
                        testedBy,
                        textToTranslate: item.text,
                        sourceLanguage: 'auto',
                        targetLanguage: targetLanguageLabel,
                        sessionId
                    };
                    if (result.success) {
                        return { ...base, outcome: 'Success', translatedText: result.translated_text,
                            observation: mass.observationFor(item, 'Mass translation') };
                    }
                    const errorMessage = result.error || 'Translation failed - Unknown error';
                    return { ...base, outcome: 'Failure', translatedText: `ERROR: ${errorMessage}`,
                        observation: mass.observationFor(item, 'Mass translation FAILED', ` - Error: ${errorMessage}`) };
                });

                savedRows.push(...await insertResults(records));
                successful += records.filter((r) => r.outcome === 'Success').length;
            }

            const totalTranslations = texts.length * targetLanguages.length;
            const workbook = mass.sessionResultsWorkbook(savedRows, languages);

            await UPDATE(MassTranslations, job.ID).with({
                status: 'Completed',
                sessionId,
                totalRows,
                successful,
                failed: totalTranslations - successful,
                successRate: totalTranslations > 0 ? round((successful / totalTranslations) * 100, 2) : 0,
                labelTypes: Object.entries(labelTypes)
                    .filter(([, n]) => n > 0)
                    .map(([type, n]) => `${LABEL_TYPE_NAMES[type]}: ${n}`)
                    .join(', ') || null,
                resultFileName: `translation_results_${timestampForFilename()}.xlsx`,
                resultFile: await workbookToBuffer(workbook)
            });

            await logActivity(req, 'massTranslate', {
                details: `${job.fileName}: ${totalRows} rows × ${targetLanguages.length} languages, ${successful} successful`,
                language: targetLanguages.join(', '),
                itemCount: totalTranslations,
                sessionId
            });
            req.info(`Mass translation completed: ${successful} of ${totalTranslations} successful`);
        });

        return super.init();
    }
};
