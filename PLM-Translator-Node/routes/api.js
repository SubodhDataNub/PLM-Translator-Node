/**
 * API routes for DN Translator application.
 * Handles REST API endpoints for translation, test results, and data management.
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const models = require('../models');
const { translatorService } = require('../services/translator');
const { largeScaleTranslator } = require('../services/largeScaleTranslator');
const { processBatchTranslation } = require('../services/massTranslation');
const { cache } = require('../services/cache');
const { ExcelJS, readSpreadsheet, addRecordsSheet, sendWorkbook } = require('../services/excel');
const {
    getUserInfo, validateTranslationRequest, parseAccuracy, parseLanguageCode,
    formatTargetLanguage, timestampForFilename, strftime
} = require('../utils');

// Configuration constant for large dataset threshold
const LARGE_DATASET_THRESHOLD = 1000; // Lowered to use chunked processing earlier

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 }
});

/** Run the single-file upload middleware, turning multer errors into JSON responses */
function uploadFile(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: `File upload error: ${err.message}` });
        }
        next();
    });
}

function isExcelFilename(filename) {
    return /\.(xlsx|xls)$/i.test(filename || '');
}

/** Parse an integer query parameter (Flask's request.args.get(name, default, type=int)) */
function intParam(value, fallback) {
    if (value === undefined || value === null || !/^[+-]?\d+$/.test(String(value).trim())) {
        return fallback;
    }
    return parseInt(value, 10);
}

/** Apply outcome/language/search filters used by the export endpoint */
function applyExportFilters(query, { outcome, language, q }) {
    if (outcome) {
        const of = String(outcome).trim();
        // Be flexible when filtering for failures: accept 'Failed', 'Failure' and variants
        if (of.toLowerCase().includes('fail')) {
            models.whereILike(query, 'outcome', '%fail%');
        } else {
            query.where('outcome', of);
        }
    }
    if (language) {
        // target_language stored as 'code-Name' so match either code or name
        models.whereILike(query, 'target_language', `%${language}%`);
    }
    if (q) {
        // Search across several text fields
        const likeQ = `%${q}%`;
        query.where((qb) => {
            models.whereILike(qb, 'tested_by', likeQ, 'orWhereRaw');
            models.whereILike(qb, 'observation', likeQ, 'orWhereRaw');
            models.whereILike(qb, 'text_to_translate', likeQ, 'orWhereRaw');
            models.whereILike(qb, 'translated_text', likeQ, 'orWhereRaw');
        });
    }
    return query;
}

/** API endpoint to get supported languages */
router.get('/languages', async (req, res) => {
    const languages = await translatorService.getSupportedLanguages();
    res.json({ success: true, languages });
});

/** API endpoint for text translation */
router.post('/translate', async (req, res) => {
    const data = req.body;
    const [valid, error] = validateTranslationRequest(data);
    if (!valid) {
        return res.status(400).json({ success: false, error });
    }

    const sourceText = String(data.text).trim();
    const targetLanguage = String(data.target_language).trim();

    // Perform translation
    const result = await translatorService.translateText(sourceText, targetLanguage);
    res.status(result.success ? 200 : 500).json(result);
});

/** API endpoint to get current user information */
router.get('/azure-user', (req, res) => {
    const userInfo = getUserInfo();
    res.json({ success: true, ...userInfo, timestamp: new Date().toISOString() });
});

/** API endpoint to save test results to database */
router.post('/save-test-results', async (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'No data provided' });
        }

        // Validate required fields
        if (!data.outcome) {
            return res.status(400).json({ success: false, error: 'Outcome is required' });
        }

        // Validate accuracy field (optional for mass translations)
        let accuracy = null;
        if (data.accuracy !== null && data.accuracy !== undefined && data.accuracy !== '') {
            const [valid, error, value] = parseAccuracy(data.accuracy);
            if (!valid) {
                return res.status(400).json({ success: false, error });
            }
            accuracy = value;
        }

        const languages = await translatorService.getSupportedLanguages();
        const saved = await models.createTestResult({
            outcome: data.outcome === 'Failed' ? 'Failure' : data.outcome,
            accuracy,
            observation: data.observation,
            tested_by: data.testedBy,
            text_to_translate: data.sourceText,
            translated_text: data.translatedText,
            source_language: 'sourceLanguage' in data ? data.sourceLanguage : 'auto',
            target_language: formatTargetLanguage(data.targetLanguage, languages),
            session_id: 'sessionId' in data ? data.sessionId : crypto.randomUUID()
        });

        res.json({
            success: true,
            message: 'Test results saved successfully to database',
            result_id: saved.id,
            data: models.toDict(saved)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: `Failed to save test results: ${e.message}` });
    }
});

/** API endpoint to retrieve test results from database */
router.get('/test-results', async (req, res) => {
    try {
        const db = models.getDb();

        // Check if requesting a specific result by ID
        const resultId = intParam(req.query.id, null);
        if (resultId) {
            const result = await models.getTestResult(resultId);
            if (result) {
                return res.json({ success: true, results: [models.toDict(result)] });
            }
            return res.status(404).json({ success: false, error: 'Test result not found' });
        }

        // Get query parameters for pagination and filtering
        let page = intParam(req.query.page, 1);
        let perPage = intParam(req.query.per_page, 10);
        if (page < 1) page = 1;
        if (perPage < 1) perPage = 20;
        const outcomeFilter = req.query.outcome;

        // Build query with filters
        const filtered = () => {
            const query = db(models.TABLE);
            if (outcomeFilter) {
                // Accept both the new 'Failure' label and legacy 'Failed' values when filtering
                const of = String(outcomeFilter).trim();
                if (['failed', 'failure'].includes(of.toLowerCase())) {
                    query.whereIn('outcome', ['Failed', 'Failure']);
                } else {
                    query.where('outcome', of);
                }
            }
            return query;
        };

        const [{ count }] = await filtered().count('* as count');
        const total = Number(count);
        const pages = Math.ceil(total / perPage);

        // Order by most recent first, then paginate
        const rows = await filtered()
            .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
            .limit(perPage)
            .offset((page - 1) * perPage);

        res.json({
            success: true,
            data: rows.map((row) => models.toDict(models.toTestResult(row))),
            pagination: {
                page,
                per_page: perPage,
                total,
                pages,
                has_next: page < pages,
                has_prev: page > 1
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: `Failed to retrieve test results: ${e.message}` });
    }
});

/** API endpoint to export test results as Excel file */
router.get('/export-test-results', async (req, res) => {
    try {
        const db = models.getDb();
        const query = applyExportFilters(db(models.TABLE), {
            outcome: req.query.outcome,
            language: req.query.language,
            q: req.query.q
        });

        // Order and fetch results
        const rows = await query.orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No test results to export' });
        }

        const records = rows.map((row) => {
            const result = models.toTestResult(row);
            // Normalize outcome display - show "Failed" for any failure variant for better UX
            const outcome = result.outcome && ['failed', 'failure'].includes(result.outcome.toLowerCase())
                ? 'Failed'
                : result.outcome;
            return {
                'ID': result.id,
                'Text to Translate': result.text_to_translate,
                'Translated Text': result.translated_text,
                'Source Language': result.source_language,
                'Target Language': result.target_language,
                'Outcome': outcome,
                'Observation': result.observation,
                'Accuracy (%)': result.accuracy,
                'Tested By': result.tested_by,
                'Date Created': result.created_at ? strftime(result.created_at, '%Y-%m-%d %H:%M:%S') : '',
                'Session ID': result.session_id
            };
        });

        const workbook = new ExcelJS.Workbook();
        addRecordsSheet(workbook, 'Test Results', records);
        await sendWorkbook(res, workbook, `test_results_${timestampForFilename()}.xlsx`);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** API endpoint to delete a specific test result */
router.delete('/test-results/:resultId', async (req, res) => {
    try {
        const { resultId } = req.params;
        if (!/^\d+$/.test(resultId)) {
            return res.status(404).json({ error: 'Test result not found' });
        }

        const deleted = await models.getDb()(models.TABLE).where({ id: parseInt(resultId, 10) }).del();
        if (!deleted) {
            return res.status(404).json({ error: 'Test result not found' });
        }
        res.json({ message: 'Test result deleted successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** API endpoint to validate large Excel files before processing */
router.post('/validate-large-file', uploadFile, async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        if (!file.originalname) {
            return res.status(400).json({ success: false, error: 'No file selected' });
        }
        if (!isExcelFilename(file.originalname)) {
            return res.status(400).json({ success: false, error: 'Please upload an Excel file (.xlsx or .xls)' });
        }

        const validationResult = await largeScaleTranslator.validateLargeFile(file.buffer, file.size);
        if (!validationResult.success) {
            return res.status(400).json(validationResult);
        }

        // Add processing time estimates
        const totalRows = validationResult.total_rows;
        if (Number.isInteger(totalRows)) {
            // Check if target languages are provided in the request
            let languageCount = 1;
            const targetLanguagesParam = req.body && req.body.target_languages;
            if (targetLanguagesParam) {
                try {
                    const targetLanguages = JSON.parse(targetLanguagesParam);
                    if (Array.isArray(targetLanguages)) {
                        languageCount = targetLanguages.length;
                    }
                } catch (e) {
                    // Use default language count
                }
            }
            validationResult.time_estimates = largeScaleTranslator.estimateProcessingTime(totalRows, languageCount);
        }

        res.json(validationResult);
    } catch (e) {
        res.status(500).json({ success: false, error: `File validation error: ${e.message}` });
    }
});

/** API endpoint to estimate processing time based on row count and target languages */
router.post('/estimate-processing-time', (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'No data provided' });
        }

        const recordCount = data.record_count ?? 0;
        const targetLanguages = data.target_languages ?? [];

        if (!Number.isInteger(recordCount) || recordCount <= 0) {
            return res.status(400).json({ success: false, error: 'Valid record_count is required' });
        }
        if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
            return res.status(400).json({ success: false, error: 'Valid target_languages list is required' });
        }

        const languageCount = targetLanguages.length;
        res.json({
            success: true,
            time_estimates: largeScaleTranslator.estimateProcessingTime(recordCount, languageCount),
            total_translations: recordCount * languageCount
        });
    } catch (e) {
        res.status(500).json({ success: false, error: `Error calculating estimates: ${e.message}` });
    }
});

/** API endpoint for mass translation from Excel file - with batch processing for speed */
router.post('/mass-translate', uploadFile, async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const body = req.body || {};
        const targetLanguagesJson = body.target_languages;
        const testedBy = body.tested_by;

        if (!file.originalname) {
            return res.status(400).json({ success: false, error: 'No file selected' });
        }
        if (!testedBy || !String(testedBy).trim()) {
            return res.status(400).json({ success: false, error: 'Tested by field is required' });
        }
        if (!targetLanguagesJson) {
            return res.status(400).json({ success: false, error: 'Target languages are required' });
        }

        // Parse target languages from JSON
        let targetLanguages;
        try {
            targetLanguages = JSON.parse(targetLanguagesJson);
            if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
                throw new Error('Invalid target languages format');
            }
            targetLanguages = targetLanguages.map((lang) => String(lang));
        } catch (e) {
            return res.status(400).json({ success: false, error: `Invalid target languages format: ${e.message}` });
        }

        if (!isExcelFilename(file.originalname)) {
            return res.status(400).json({ success: false, error: 'Please upload an Excel file (.xlsx or .xls)' });
        }

        // Read Excel file
        let table;
        try {
            table = await readSpreadsheet(file.buffer);
        } catch (e) {
            return res.status(400).json({ success: false, error: `Error reading Excel file: ${e.message}` });
        }

        // Validate Excel structure
        if (table.columns.length === 0 || table.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Excel file is empty' });
        }

        const totalRows = table.rows.length;
        const sessionId = `mass_translation_${timestampForFilename()}_${crypto.randomBytes(4).toString('hex')}`;

        // Process with batch translation
        const result = await processBatchTranslation(table, targetLanguages, totalRows, String(testedBy).trim(), sessionId);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: `Server error: ${e.message}` });
    }
});

/** API endpoint to poll translation job progress */
router.get('/translation-progress/:jobId', (req, res) => {
    try {
        const jobStatus = cache.get(`job_${req.params.jobId}_status`);
        if (!jobStatus) {
            return res.status(404).json({ success: false, error: 'Job not found or expired' });
        }
        res.json({ success: true, ...jobStatus });
    } catch (e) {
        res.status(500).json({ success: false, error: `Error retrieving job status: ${e.message}` });
    }
});

/** API endpoint to download Excel template for mass translation */
router.get('/download-template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();

        // Sample data for the template
        const templateData = [
            { 'Phrase Text': 'Hello, how are you?' },
            { 'Phrase Text': 'Thank you for your help.' },
            { 'Phrase Text': 'Please review this document.' }
        ];
        const worksheet = addRecordsSheet(workbook, 'Translation Data', templateData);

        // Add header styling
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' }, bgColor: { argb: 'FF366092' } };
        });

        // Add instructions sheet
        const instructionsData = [
            'Mass Translation Template Instructions',
            '',
            'How to use this template:',
            '1. Replace the sample data with your own text to translate',
            '2. Keep the column headers as they are',
            '3. Supported column names: text, content, message, description',
            '4. You can use either "text" or "description" column (or both)',
            '5. Maximum 5000 characters per text entry',
            '6. Save the file as .xlsx or .xls format',
            '7. Upload the file to the DN Translator mass translation page',
            '',
            'Column Descriptions:',
            '- text: The main text content to be translated (required)',
            '- description: Optional description or context for the text',
            '',
            'Notes:',
            '- Empty rows will be skipped',
            '- Processing time depends on the number of rows',
            '- Results will include source text, translated text, and status',
            '- You can download the translation results after processing'
        ];
        const instructionsWs = workbook.addWorksheet('Instructions');
        instructionsData.forEach((line) => instructionsWs.addRow([line]));
        instructionsWs.getColumn('A').width = 80;

        // Style the title
        instructionsWs.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF366092' } };

        await sendWorkbook(res, workbook, 'mass_translation_template.xlsx');
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const MASS_OBSERVATION_ROW = /^Mass translation(?: FAILED)? - Row (\d+)/;

function isFailureOutcome(outcome) {
    return ['failure', 'failed'].includes(String(outcome || '').toLowerCase());
}

/**
 * Recover the original spreadsheet description and the error message from a mass translation record.
 * Observations look like 'Mass translation - Row 3 - <description>' or
 * 'Mass translation FAILED - Row 3 - Error: <error> - <description>' (translated_text is 'ERROR: <error>').
 */
function parseMassObservation(record) {
    const observation = record.observation || '';
    if (!isFailureOutcome(record.outcome)) {
        const match = observation.match(/^Mass translation - Row \d+(?: - ([\s\S]*))?$/);
        return { description: match && match[1] ? match[1] : '', error: '' };
    }

    const errorMessage = (record.translated_text || '').replace(/^ERROR: /, '');
    let description = '';
    const prefix = observation.match(/^Mass translation FAILED - Row \d+ - Error: /);
    if (prefix && errorMessage) {
        const rest = observation.slice(prefix[0].length);
        if (rest.startsWith(errorMessage)) {
            description = rest.slice(errorMessage.length).replace(/^ - /, '');
        }
    }
    return { description, error: errorMessage || observation || 'Translation failed' };
}

/**
 * Build the results sheet for a mass translation session: one row per source text,
 * with one column per target language (in the order the languages were translated).
 */
function buildSessionResultSheet(records, languagesList) {
    const languageMap = {};
    for (const lang of languagesList) {
        if (lang.key) languageMap[lang.key] = lang.text;
    }

    const languageHeaders = new Map(); // language code -> column header
    const groups = new Map();          // source row -> { row, sourceText, description, translations, errors }

    records.forEach((record, i) => {
        const match = (record.observation || '').match(MASS_OBSERVATION_ROW);
        const rowNum = match ? parseInt(match[1], 10) : i + 1;
        const key = match ? `row:${rowNum}` : `id:${record.id}`;

        const code = parseLanguageCode(record.target_language, languagesList);
        if (!languageHeaders.has(code)) {
            const storedName = (record.target_language || '').slice(code.length + 1);
            const name = languageMap[code] || storedName || code.toUpperCase();
            languageHeaders.set(code, `${name} (${code.toUpperCase()})`);
        }

        let group = groups.get(key);
        if (!group) {
            group = { row: rowNum, sourceText: record.text_to_translate || '', description: '', translations: {}, errors: {} };
            groups.set(key, group);
        }

        const { description, error } = parseMassObservation(record);
        if (description && !group.description) group.description = description;
        if (isFailureOutcome(record.outcome)) {
            group.errors[code] = error;
        } else {
            group.translations[code] = record.translated_text || '';
        }
    });

    const rows = [...groups.values()].sort((a, b) => a.row - b.row);
    const hasDescription = rows.some((group) => group.description);
    const fixedColumns = ['Row', 'Source Text', 'Status', ...(hasDescription ? ['Description'] : [])];
    const columns = [...fixedColumns, ...languageHeaders.values(), 'Errors'];

    const sheetRecords = rows.map((group) => {
        const failedCodes = Object.keys(group.errors);
        let status = 'Success';
        if (failedCodes.length > 0) {
            status = Object.keys(group.translations).length > 0 ? 'Partial' : 'Failed';
        }

        // Missing values are left as truly blank cells (null), not empty strings
        const record = { 'Row': group.row, 'Source Text': group.sourceText, 'Status': status };
        if (hasDescription) record['Description'] = group.description || null;
        for (const [code, header] of languageHeaders) {
            record[header] = group.translations[code] ?? null;
        }
        record['Errors'] = failedCodes.map((code) => `${code.toUpperCase()}: ${group.errors[code]}`).join('; ') || null;
        return record;
    });

    return { columns, records: sheetRecords, frozenColumns: fixedColumns.length };
}

/** Build sheet rows from client-provided results (backward compatibility) */
function buildLegacyResultRecords(results, languagesList) {
    const languageMap = {};
    for (const lang of languagesList) {
        if (lang.key) languageMap[lang.key] = lang.text;
    }

    // Create rows from results - handle multiple languages
    return results.map((result) => {
        const baseRow = {
            'Row': result.row ?? '',
            'Source Text': result.source_text ?? '',
            'Status': result.success ? 'Success' : 'Failed'
        };

        // Add description if available from the original data
        if (result.description) {
            baseRow['Description'] = result.description;
        }

        const translations = result.translations || {};
        if (result.success && Object.keys(translations).length > 0) {
            // Multiple languages - create columns for each language
            for (const [langCode, translation] of Object.entries(translations)) {
                const langDescription = languageMap[langCode] || langCode.toUpperCase();
                baseRow[`${langDescription} (${langCode.toUpperCase()})`] = translation;
            }

            if ('successful_languages' in result) {
                baseRow['Successful Languages'] = `${result.successful_languages}/${result.total_languages}`;
            }

            baseRow['Errors'] = Array.isArray(result.errors) && result.errors.length > 0
                ? result.errors.join('; ')
                : '';
        } else if (result.success && result.translated_text) {
            // Single language (backward compatibility)
            baseRow['Translation'] = result.translated_text;
            baseRow['Detected Language'] = result.detected_language || '';
            baseRow['Errors'] = '';
        } else {
            // Failed translation
            baseRow['Translation'] = '';
            baseRow['Errors'] = !result.success ? (result.error || '') : '';
        }
        return baseRow;
    });
}

/** API endpoint to download translation results as Excel file - fetches all results from database */
router.post('/download-translation-results', async (req, res) => {
    try {
        const data = req.body;

        // Get session_id to fetch all results from database
        const sessionId = data && typeof data === 'object' ? data.session_id : null;

        // Get language descriptions for mapping
        const languagesList = await translatorService.getSupportedLanguages();

        let sheet;
        if (sessionId) {
            // Fetch all results from database by session_id
            const rows = await models.getDb()(models.TABLE).where({ session_id: sessionId }).orderBy('id');
            if (rows.length === 0) {
                return res.status(400).json({ error: 'No translation results found for this session' });
            }
            sheet = buildSessionResultSheet(rows.map(models.toTestResult), languagesList);
        } else if (data && typeof data === 'object' && 'results' in data) {
            // Fallback to provided results (for backward compatibility)
            if (!Array.isArray(data.results) || data.results.length === 0) {
                return res.status(400).json({ error: 'No translation results to download' });
            }
            sheet = { columns: null, records: buildLegacyResultRecords(data.results, languagesList), frozenColumns: 2 };
        } else {
            return res.status(400).json({ error: 'No translation results or session_id provided' });
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = addRecordsSheet(workbook, 'Translation Results', sheet.records, { columns: sheet.columns });

        // Keep the header and source columns visible while scrolling across languages,
        // and wrap long texts so translations side by side stay readable
        worksheet.views = [{ state: 'frozen', xSplit: sheet.frozenColumns, ySplit: 1 }];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) row.alignment = { wrapText: true, vertical: 'top' };
        });

        await sendWorkbook(res, workbook, `translation_results_${timestampForFilename()}.xlsx`);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router, LARGE_DATASET_THRESHOLD };
