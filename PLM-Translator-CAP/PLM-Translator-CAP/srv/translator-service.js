'use strict';

const cds = require('@sap/cds');
const crypto = require('crypto');
const config = require('./lib/config');
const { translatorService } = require('./lib/translator');
const { normalizeLabelType } = require('./lib/terminology');
const { ExcelJS, XLSX_MIME, readSpreadsheet, addRecordsSheet, workbookToBuffer } = require('./lib/excel');
const mass = require('./lib/mass-translation');
const {
    getUserInfo, validateTranslationInput, parseAccuracy, formatTargetLanguage,
    timestampForFilename, formatDateTime, round
} = require('./lib/utils');

const LOG = cds.log('translator');
const INSERT_CHUNK_SIZE = 500;

const ref = (name) => ({ ref: [name] });
const lower = (name) => ({ func: 'tolower', args: [ref(name)] });
const like = (name, text) => [lower(name), 'like', { val: `%${String(text).toLowerCase()}%` }];
const FAILED_OUTCOMES = ['Failed', 'Failure'];

function isFailedFilter(outcome) {
    return String(outcome || '').toLowerCase().includes('fail');
}

function and(conditions) {
    const where = [];
    conditions.forEach((condition, i) => {
        if (i > 0) where.push('and');
        where.push({ xpr: condition });
    });
    return where;
}

function outcomeCondition(outcome) {
    if (isFailedFilter(outcome)) {
        return [ref('outcome'), 'in', { list: FAILED_OUTCOMES.map((val) => ({ val })) }];
    }
    return [ref('outcome'), '=', { val: outcome }];
}

function resultFilter({ outcome, language, search } = {}) {
    const conditions = [];
    outcome = String(outcome || '').trim();
    language = String(language || '').trim();
    search = String(search || '').trim();

    if (outcome) conditions.push(outcomeCondition(outcome));
    if (language) conditions.push(like('targetLanguage', language));
    if (search) {
        const fields = ['testedBy', 'observation', 'textToTranslate', 'translatedText'];
        const anyField = [];
        fields.forEach((field, i) => {
            if (i > 0) anyField.push('or');
            anyField.push(...like(field, search));
        });
        conditions.push(anyField);
    }
    return and(conditions);
}

function withWhere(query, where) {
    if (where.length) query.SELECT.where = where;
    return query;
}

function excelFile(fileName, buffer) {
    return { fileName, mimeType: XLSX_MIME, content: buffer.toString('base64') };
}

function decodeUpload(req, fileName, content) {
    if (!content) return req.reject(400, 'No file uploaded');
    if (!fileName) return req.reject(400, 'No file selected');
    if (!mass.isExcelFilename(fileName)) return req.reject(400, 'Please upload an Excel file (.xlsx or .xls)');
    const buffer = Buffer.from(String(content).replace(/^data:[^,]*,/, ''), 'base64');
    if (buffer.length > config.maxUploadMb * 1024 * 1024) {
        return req.reject(413, `File is larger than ${config.maxUploadMb} MB`);
    }
    return buffer;
}

module.exports = class TranslatorService extends cds.ApplicationService {
    init() {
        const { TestResults } = this.entities;
        const db = cds.entities('plm.translator');

        let nextId = null;
        let idInit = null;
        const allocateIds = async (count) => {
            if (nextId === null) {
                idInit ??= SELECT.one.from(db.TestResults).columns('max(ID) as maxId')
                    .then((row) => { nextId ??= ((row && row.maxId) || 0) + 1; });
                await idInit;
            }
            const first = nextId;
            nextId += count;
            return first;
        };

        const insertResults = async (records) => {
            if (!records.length) return;
            const firstId = await allocateIds(records.length);
            const now = new Date().toISOString();
            const rows = records.map((record, i) => ({ ID: firstId + i, createdAt: now, ...record }));
            for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
                await INSERT.into(db.TestResults).entries(rows.slice(i, i + INSERT_CHUNK_SIZE));
            }
        };

        const languageList = () => translatorService.getSupportedLanguages();

        this.before('CREATE', TestResults, async (req) => {
            const data = req.data;
            if (!data.outcome) return req.reject(400, 'Outcome is required');
            if (data.outcome === 'Failed') data.outcome = 'Failure';

            if (data.accuracy === null || data.accuracy === undefined || data.accuracy === '') {
                data.accuracy = null;
            } else {
                const [valid, error, value] = parseAccuracy(data.accuracy);
                if (!valid) return req.reject(400, error);
                data.accuracy = value;
            }

            data.sourceLanguage ??= 'auto';
            data.sessionId ??= crypto.randomUUID();
            data.targetLanguage = formatTargetLanguage(data.targetLanguage, await languageList());
            data.ID = await allocateIds(1);
        });

        this.before('UPDATE', TestResults, (req) => {
            if ('accuracy' in req.data && req.data.accuracy !== null) {
                const [valid, error, value] = parseAccuracy(req.data.accuracy);
                if (!valid) return req.reject(400, error);
                req.data.accuracy = value;
            }
        });

        this.on('languages', async () => {
            const languages = await languageList();
            return languages.filter((lang) => lang.key).map((lang) => ({ code: lang.key, name: lang.text }));
        });

        this.on('translate', async (req) => {
            const text = String(req.data.text ?? '').trim();
            const targetLanguage = String(req.data.targetLanguage ?? '').trim();
            const error = validateTranslationInput(text, targetLanguage);
            if (error) return req.reject(400, error);

            const result = await translatorService.translateText(text, targetLanguage, {
                labelType: normalizeLabelType(req.data.labelType)
            });
            if (!result.success) return req.reject(500, result.error);

            return {
                translatedText: result.translated_text,
                sourceLanguage: result.source_language,
                targetLanguage: result.target_language,
                labelType: result.label_type,
                labelTypeDetected: result.label_type_detected,
                terminology: result.terminology
                    ? { official: result.terminology.official || [], kept: result.terminology.kept || [], skipped: Boolean(result.terminology.skipped) }
                    : null
            };
        });

        this.on('userInfo', () => getUserInfo());

        const count = async (where) => {
            const row = await withWhere(SELECT.one.from(db.TestResults).columns('count(1) as n'), where);
            return Number((row && row.n) || 0);
        };

        this.on('resultStatistics', async (req) => {
            const filters = req.data;
            const where = resultFilter(filters);
            const filtered = where.length > 0;
            const withOutcome = (outcome) => and([...(filtered ? [where] : []), outcomeCondition(outcome)]);

            const unfiltered = await count([]);
            const total = filtered ? await count(where) : unfiltered;
            const success = await count(withOutcome('Success'));
            const partial = await count(withOutcome('Partial'));
            let failed = await count(withOutcome('Failed'));
            if (!filtered && failed === 0 && total > 0) failed = total - success - partial;

            return {
                total, success, partial, failed, unfiltered,
                successRate: total > 0 ? round((success / total) * 100, 1) : 0
            };
        });

        this.on('resultLanguages', async () => {
            const rows = await SELECT.distinct.from(db.TestResults).columns('targetLanguage')
                .where('targetLanguage is not null').orderBy('targetLanguage');
            return rows.map((row) => row.targetLanguage).filter(Boolean);
        });

        this.on('exportTestResults', async (req) => {
            const rows = await withWhere(SELECT.from(db.TestResults), resultFilter(req.data))
                .orderBy('createdAt desc', 'ID desc');
            if (rows.length === 0) return req.reject(404, 'No test results to export');

            const records = rows.map((row) => ({
                'ID': row.ID,
                'Text to Translate': row.textToTranslate,
                'Translated Text': row.translatedText,
                'Source Language': row.sourceLanguage,
                'Target Language': row.targetLanguage,
                'Outcome': mass.isFailureOutcome(row.outcome) ? 'Failed' : row.outcome,
                'Observation': row.observation,
                'Accuracy (%)': row.accuracy,
                'Tested By': row.testedBy,
                'Date Created': formatDateTime(row.createdAt),
                'Session ID': row.sessionId
            }));

            const workbook = new ExcelJS.Workbook();
            addRecordsSheet(workbook, 'Test Results', records);
            return excelFile(`test_results_${timestampForFilename()}.xlsx`, await workbookToBuffer(workbook));
        });

        this.on('estimateProcessingTime', (req) => {
            const { recordCount, targetLanguages } = req.data;
            if (!Number.isInteger(recordCount) || recordCount <= 0) {
                return req.reject(400, 'Valid recordCount is required');
            }
            if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
                return req.reject(400, 'Valid targetLanguages list is required');
            }
            return mass.estimateProcessingTime(recordCount, targetLanguages.length);
        });

        this.on('validateFile', async (req) => {
            const { fileName, content, targetLanguages } = req.data;
            const buffer = decodeUpload(req, fileName, content);
            if (!Buffer.isBuffer(buffer)) return;
            const languageCount = Array.isArray(targetLanguages) && targetLanguages.length ? targetLanguages.length : 1;
            try {
                return await mass.validateWorkbook(buffer, languageCount);
            } catch (e) {
                return req.reject(400, e.message);
            }
        });

        this.on('massTranslate', async (req) => {
            const { fileName, content } = req.data;
            const testedBy = String(req.data.testedBy || '').trim();
            const labelType = normalizeLabelType(req.data.labelType);
            const targetLanguages = (req.data.targetLanguages || []).map(String).filter(Boolean);

            if (!testedBy) return req.reject(400, 'Tested by field is required');
            if (targetLanguages.length === 0) return req.reject(400, 'Target languages are required');
            const buffer = decodeUpload(req, fileName, content);
            if (!Buffer.isBuffer(buffer)) return;

            let table;
            try {
                table = await readSpreadsheet(buffer);
            } catch (e) {
                return req.reject(400, `Error reading Excel file: ${e.message}`);
            }
            if (table.columns.length === 0 || table.rows.length === 0) {
                return req.reject(400, 'Excel file is empty');
            }

            const totalRows = table.rows.length;
            const sessionId = `mass_translation_${timestampForFilename()}_${crypto.randomBytes(4).toString('hex')}`;
            const { textsData } = mass.collectTexts(table);
            const texts = textsData.map((item) => item.text);
            const languages = await languageList();
            const labelTypes = { general: 0, food: 0, cosmetic: 0 };
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

                await insertResults(records);
                successful += records.filter((r) => r.outcome === 'Success').length;
            }

            const totalTranslations = totalRows * targetLanguages.length;
            return {
                message: `Mass translation completed: ${successful} successful`,
                sessionId,
                labelType,
                totalRows,
                successful,
                failed: totalTranslations - successful,
                successRate: totalRows > 0 ? round((successful / totalTranslations) * 100, 2) : 0,
                languagesCount: targetLanguages.length,
                targetLanguages,
                labelTypes
            };
        });

        this.on('downloadSessionResults', async (req) => {
            const { sessionId } = req.data;
            if (!sessionId) return req.reject(400, 'sessionId is required');
            const rows = await SELECT.from(db.TestResults).where({ sessionId }).orderBy('ID');
            if (rows.length === 0) return req.reject(404, 'No translation results found for this session');

            const workbook = mass.sessionResultsWorkbook(rows, await languageList());
            return excelFile(`translation_results_${timestampForFilename()}.xlsx`, await workbookToBuffer(workbook));
        });

        this.on('downloadTemplate', async () => {
            return excelFile('mass_translation_template.xlsx', await workbookToBuffer(mass.templateWorkbook()));
        });

        return super.init();
    }
};
