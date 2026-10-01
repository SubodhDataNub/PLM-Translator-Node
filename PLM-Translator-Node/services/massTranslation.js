/**
 * Mass translation processing (Excel upload -> batch translation -> test_results table).
 */
'use strict';

const models = require('../models');
const { cache } = require('./cache');
const { translatorService } = require('./translator');
const { largeScaleTranslator, DESCRIPTION_COLUMNS, isBlankText } = require('./largeScaleTranslator');
const { cellToString } = require('./excel');
const { formatTargetLanguage, round } = require('../utils');
const config = require('../config');

const BATCH_TEXT_COLUMNS = ['Phrase Text', 'phrase text', 'PHRASE TEXT', 'text', 'Text', 'TEXT',
    'content', 'Content', 'CONTENT', 'message', 'Message', 'MESSAGE'];
const STANDARD_TEXT_COLUMNS = [...BATCH_TEXT_COLUMNS, 'description', 'Description'];

function findTextColumn(columns, candidates = BATCH_TEXT_COLUMNS) {
    return candidates.find((col) => columns.includes(col)) || columns[0];
}

function findDescriptionColumn(columns, textColumn) {
    return DESCRIPTION_COLUMNS.find((col) => columns.includes(col) && col !== textColumn) || null;
}

/** Collect all valid texts (with row index and description) from the spreadsheet */
function collectTexts(table, textCandidates = BATCH_TEXT_COLUMNS) {
    const textColumn = findTextColumn(table.columns, textCandidates);
    const descriptionColumn = findDescriptionColumn(table.columns, textColumn);

    const textsData = [];
    table.rows.forEach((row, index) => {
        const sourceText = cellToString(row[textColumn]).trim();
        let description = '';
        if (descriptionColumn) {
            description = cellToString(row[descriptionColumn]).trim();
            if (isBlankText(description)) description = '';
        }
        if (!isBlankText(sourceText)) {
            textsData.push({ index, text: sourceText, description });
        }
    });
    return { textColumn, textsData };
}

function observationFor(item, prefix, suffix = '') {
    return `${prefix} - Row ${item.index + 1}${suffix}` + (item.description ? ` - ${item.description}` : '');
}

/**
 * Insert records in bulk; if that fails, fall back to individual inserts.
 * @returns {Promise<{inserted: number, failedRecords: object[]}>}
 */
async function saveRecords(records) {
    if (records.length === 0) return { inserted: 0, failedRecords: [] };
    try {
        await models.bulkInsertTestResults(records);
        return { inserted: records.length, failedRecords: [] };
    } catch (e) {
        console.error(`Bulk insert failed, falling back to individual inserts: ${e.message}`);
        const failedRecords = [];
        for (const record of records) {
            try {
                await models.createTestResult(record);
            } catch (err) {
                failedRecords.push(record);
            }
        }
        return { inserted: records.length - failedRecords.length, failedRecords };
    }
}

/** Process translation using batch API calls for maximum speed */
async function processBatchTranslation(table, targetLanguages, totalRows, testedBy, sessionId, { labelType } = {}) {
    const { textsData } = collectTexts(table);
    const texts = textsData.map((item) => item.text);
    const languages = await translatorService.getSupportedLanguages();

    let successfulTranslations = 0;

    // Process each language
    for (const targetLanguage of targetLanguages) {
        const targetLanguageLabel = formatTargetLanguage(targetLanguage, languages);

        // Batch translate all texts for this language
        const batchResults = await translatorService.translateBatch(
            texts, targetLanguage, config.massTranslateBatchSize, { labelType }
        );

        // Prepare batch for database (including both successful and failed)
        const dbBatch = batchResults.map((result, idx) => {
            const item = textsData[idx];
            if (result.success) {
                return {
                    outcome: 'Success',
                    accuracy: 0,
                    observation: observationFor(item, 'Mass translation'),
                    tested_by: testedBy,
                    text_to_translate: item.text,
                    translated_text: result.translated_text,
                    source_language: 'auto',
                    target_language: targetLanguageLabel,
                    session_id: sessionId
                };
            }
            // Save failed translations with error details
            const errorMessage = result.error || 'Translation failed - Unknown error';
            return {
                outcome: 'Failure',
                accuracy: 0,
                observation: observationFor(item, 'Mass translation FAILED', ` - Error: ${errorMessage}`),
                tested_by: testedBy,
                text_to_translate: item.text,
                translated_text: `ERROR: ${errorMessage}`,
                source_language: 'auto',
                target_language: targetLanguageLabel,
                session_id: sessionId
            };
        });

        const { failedRecords } = await saveRecords(dbBatch);
        const savedSuccesses = dbBatch.filter((r) => r.outcome === 'Success').length
            - failedRecords.filter((r) => r.outcome === 'Success').length;
        successfulTranslations += savedSuccesses;
    }

    // Calculate statistics
    const totalTranslations = totalRows * targetLanguages.length;
    return {
        success: true,
        message: `Mass translation completed: ${successfulTranslations} successful`,
        session_id: sessionId,
        label_type: labelType,
        statistics: {
            total_rows: totalRows,
            successful: successfulTranslations,
            failed: totalTranslations - successfulTranslations,
            success_rate: totalRows > 0 ? round((successfulTranslations / totalTranslations) * 100, 2) : 0,
            languages_count: targetLanguages.length,
            target_languages: targetLanguages
        }
    };
}

// ---------------------------------------------------------------------------
// Background processing with progress tracking (polled via /api/translation-progress/<job_id>)
// ---------------------------------------------------------------------------

function setJobStatus(jobId, status) {
    cache.set(`job_${jobId}_status`, status);
}

/** Background processing function for mass translation */
async function processTranslationBackground(jobId, sessionId, table, targetLanguages, totalRows, testedBy, useChunked) {
    try {
        console.log(`[DEBUG] Background processing started - Job ID: ${jobId}, Rows: ${totalRows}, Chunked: ${useChunked}`);
        if (useChunked) {
            await processLargeDatasetChunkedWithProgress(jobId, sessionId, table, targetLanguages, totalRows, testedBy);
        } else {
            await processStandardDatasetWithProgress(jobId, sessionId, table, targetLanguages, totalRows, testedBy);
        }
    } catch (e) {
        console.error(`[ERROR] Background processing failed: ${e.stack || e.message}`);
        setJobStatus(jobId, {
            status: 'error',
            progress: 100,
            total: totalRows,
            successful: 0,
            failed: totalRows,
            current_row: 0,
            session_id: sessionId,
            message: `Processing error: ${e.message}`
        });
    }
}

/** Process smaller datasets with batch translation and progress updates */
async function processStandardDatasetWithProgress(jobId, sessionId, table, targetLanguages, totalRows, testedBy) {
    const { textColumn, textsData } = collectTexts(table, STANDARD_TEXT_COLUMNS);
    console.log(`[DEBUG] Using text column: ${textColumn}`);
    console.log(`[DEBUG] Collected ${textsData.length} valid texts from ${totalRows} rows`);

    const texts = textsData.map((item) => item.text);
    const languages = await translatorService.getSupportedLanguages();
    let successfulTranslations = 0;
    let failedTranslations = 0;

    const status = (fields) => setJobStatus(jobId, {
        status: 'processing',
        total: totalRows,
        successful: successfulTranslations,
        failed: failedTranslations,
        current_row: texts.length,
        session_id: sessionId,
        ...fields
    });

    status({ progress: 5, current_row: 0, message: `Starting batch translation for ${textsData.length} valid texts...` });

    for (let langIdx = 0; langIdx < targetLanguages.length; langIdx++) {
        const targetLanguage = targetLanguages[langIdx];
        const langLabel = targetLanguage.toUpperCase();
        const position = `(${langIdx + 1}/${targetLanguages.length} languages)`;
        let progressPercent = 10 + Math.trunc((langIdx / targetLanguages.length) * 80);

        try {
            status({ progress: progressPercent, message: `Translating to ${langLabel}... ${position}` });

            const batchResults = await translatorService.translateBatch(texts, targetLanguage);

            status({ progress: progressPercent + 5, message: `Saving ${langLabel} translations to database...` });

            const targetLanguageLabel = formatTargetLanguage(targetLanguage, languages);
            const dbBatch = [];
            let failedInBatch = 0;
            batchResults.forEach((result, idx) => {
                if (result.success) {
                    const item = textsData[idx];
                    dbBatch.push({
                        outcome: 'Success',
                        accuracy: 0,
                        observation: observationFor(item, 'Mass translation'),
                        tested_by: testedBy,
                        text_to_translate: item.text,
                        translated_text: result.translated_text,
                        source_language: 'auto',
                        target_language: targetLanguageLabel,
                        session_id: sessionId
                    });
                } else {
                    failedInBatch += 1;
                }
            });

            const { inserted, failedRecords } = await saveRecords(dbBatch);
            successfulTranslations += inserted;
            failedTranslations += failedInBatch + failedRecords.length;

            progressPercent = 10 + Math.trunc(((langIdx + 1) / targetLanguages.length) * 80);
            status({
                progress: progressPercent,
                message: `Completed ${langLabel} ${position} - ${dbBatch.length} successful`
            });
        } catch (langError) {
            failedTranslations += textsData.length;
            status({
                progress: 10 + Math.trunc(((langIdx + 1) / targetLanguages.length) * 80),
                current_row: textsData.length,
                message: `Error translating to ${langLabel}: ${langError.message}`
            });
        }
    }

    setJobStatus(jobId, {
        status: 'completed',
        progress: 100,
        total: totalRows,
        successful: successfulTranslations,
        failed: totalRows - successfulTranslations,
        current_row: totalRows,
        session_id: sessionId,
        message: `Translation completed: ${successfulTranslations}/${totalRows} successful`,
        success_rate: totalRows > 0 ? round((successfulTranslations / totalRows) * 100, 2) : 0
    });
}

/** Process large datasets using chunked method with progress updates */
async function processLargeDatasetChunkedWithProgress(jobId, sessionId, table, targetLanguages, totalRows, testedBy) {
    const status = (fields) => setJobStatus(jobId, {
        status: 'processing',
        total: totalRows,
        successful: 0,
        failed: 0,
        current_row: totalRows,
        session_id: sessionId,
        ...fields
    });

    try {
        status({ progress: 5, current_row: 0, message: 'Starting chunked processing for large dataset...' });

        const processingResult = await largeScaleTranslator.processLargeDatasetChunked(table, targetLanguages, { sessionId });

        status({ progress: 70, message: 'Combining chunk results...' });
        const allResults = await largeScaleTranslator.combineChunkResults(processingResult.chunk_files);

        status({ progress: 80, message: 'Saving results to database...' });

        const languages = await translatorService.getSupportedLanguages();
        let successfulTranslations = 0;
        let pending = [];
        const flush = async () => {
            if (pending.length > 0) {
                await saveRecords(pending);
                pending = [];
            }
        };

        for (const result of allResults) {
            if (!result.success || !result.translations) continue;
            const description = result.description || '';
            for (const [targetLang, translatedText] of Object.entries(result.translations)) {
                const failed = typeof translatedText === 'string' && translatedText.startsWith('[ERROR]');
                pending.push({
                    outcome: failed ? 'Failure' : 'Success',
                    accuracy: 0,
                    observation: `Mass translation${failed ? ' FAILED' : ''} - Row ${result.row}` + (description ? ` - ${description}` : ''),
                    tested_by: testedBy,
                    text_to_translate: result.source_text,
                    translated_text: translatedText,
                    source_language: 'auto',
                    target_language: formatTargetLanguage(targetLang, languages),
                    session_id: sessionId
                });
                if (pending.length >= 200) await flush();
            }
            successfulTranslations += 1;
        }
        await flush();

        await largeScaleTranslator.cleanupTempFiles(processingResult.output_dir, sessionId);

        setJobStatus(jobId, {
            status: 'completed',
            progress: 100,
            total: totalRows,
            successful: successfulTranslations,
            failed: totalRows - successfulTranslations,
            current_row: totalRows,
            session_id: sessionId,
            message: `Large dataset translation completed: ${successfulTranslations}/${totalRows} rows successful`,
            success_rate: totalRows > 0 ? round((successfulTranslations / totalRows) * 100, 2) : 0,
            chunks_processed: processingResult.total_chunks
        });
    } catch (e) {
        setJobStatus(jobId, {
            status: 'error',
            progress: 100,
            total: totalRows,
            successful: 0,
            failed: totalRows,
            current_row: 0,
            session_id: sessionId,
            message: `Chunked processing error: ${e.message}`
        });
    }
}

module.exports = {
    processBatchTranslation,
    processTranslationBackground,
    processStandardDatasetWithProgress,
    processLargeDatasetChunkedWithProgress,
    collectTexts,
    findTextColumn
};
