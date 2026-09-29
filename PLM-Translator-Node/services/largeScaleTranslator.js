/**
 * Large Scale Translation Service
 * Handles mass translation with optimization for large datasets (1M+ records)
 */
'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { translatorService } = require('./translator');
const { readSpreadsheet, cellToString } = require('./excel');
const { round } = require('../utils');

const DESCRIPTION_COLUMNS = ['description', 'Description', 'DESCRIPTION', 'desc', 'Desc', 'notes', 'Notes'];
const TEXT_COLUMNS = ['text', 'Text', 'TEXT', 'content', 'Content', 'CONTENT',
    'message', 'Message', 'MESSAGE', 'description', 'Description'];

function isBlankText(text) {
    return !text || ['nan', 'none', ''].includes(text.toLowerCase());
}

/** Service for handling large scale translations with optimization */
class LargeScaleTranslator {
    constructor({ chunkSize, maxWorkers, batchSize, maxRetries } = {}) {
        const defaults = config.largeScale;
        this.chunkSize = chunkSize ?? defaults.chunkSize;       // Process in chunks of 1000 records
        this.maxWorkers = maxWorkers ?? defaults.maxWorkers;    // Maximum concurrent workers
        this.batchSize = batchSize ?? defaults.batchSize;       // Translation API batch size
        this.maxRetries = maxRetries ?? defaults.maxRetries;    // Retry failed translations
    }

    /** Estimate processing time for given number of records */
    estimateProcessingTime(recordCount, languageCount = 1) {
        // Rough estimation: 1000 records per minute with optimization
        const estimatedMinutes = (recordCount * languageCount) / 1000;
        return {
            estimated_minutes: estimatedMinutes,
            estimated_hours: estimatedMinutes / 60,
            record_count: recordCount,
            language_count: languageCount,
            recommendation: this._getProcessingRecommendation(recordCount, languageCount)
        };
    }

    /** Get processing recommendation based on record count and language count */
    _getProcessingRecommendation(recordCount, languageCount = 1) {
        const totalTranslations = recordCount * languageCount;
        const languages = `${languageCount} language${languageCount > 1 ? 's' : ''}`;

        if (totalTranslations <= 1000) {
            return `Standard processing - should complete in under 5 minutes (${languages})`;
        } else if (totalTranslations <= 10000) {
            return `Medium dataset - estimated 10-50 minutes for ${recordCount} records × ${languages}, use background processing`;
        } else if (totalTranslations <= 100000) {
            return `Large dataset - estimated 1-8 hours for ${recordCount} records × ${languages}, use chunked processing with progress tracking`;
        }
        return `Very large dataset - estimated 8+ hours for ${recordCount} records × ${languages}, consider splitting into smaller files`;
    }

    /** Translate a batch of texts, returning [{text}] entries ('[ERROR] ...' for failures) */
    async translateBatchAsync(texts, targetLanguage) {
        if (!translatorService.isConfigured()) {
            // Use mock translations for testing
            return texts.map((text) => ({ text: `[MOCK] ${text} -> ${targetLanguage}` }));
        }

        const results = await translatorService.translateBatch(texts, targetLanguage, this.batchSize);
        return results.map((result) => ({
            text: result.success ? result.translated_text : `[ERROR] ${result.error || 'Translation failed'}`
        }));
    }

    /**
     * Process large dataset in chunks with progress tracking.
     * @param {{columns: string[], rows: object[]}} table - Spreadsheet data
     */
    async processLargeDatasetChunked(table, targetLanguages, { progressCallback = null, outputDir = null, sessionId = null } = {}) {
        sessionId = sessionId || crypto.randomUUID();
        outputDir = outputDir || path.join(config.ROOT_DIR, 'temp_translations');
        await fs.mkdir(outputDir, { recursive: true });

        const totalRows = table.rows.length;
        const totalChunks = Math.ceil(totalRows / this.chunkSize);
        const startTime = Date.now();

        // Process in chunks
        const processedChunks = [];
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const startIdx = chunkIdx * this.chunkSize;
            const endIdx = Math.min(startIdx + this.chunkSize, totalRows);
            const chunkRows = table.rows.slice(startIdx, endIdx);

            // Process this chunk
            const chunkResult = await this._processChunk(chunkRows, table.columns, targetLanguages, startIdx);

            // Save chunk results to disk
            const chunkFile = path.join(outputDir, `chunk_${chunkIdx}_${sessionId}.json`);
            await fs.writeFile(chunkFile, JSON.stringify(chunkResult, null, 2), 'utf8');
            processedChunks.push(chunkFile);

            // Progress callback
            if (progressCallback) {
                progressCallback({
                    session_id: sessionId,
                    chunk: chunkIdx + 1,
                    total_chunks: totalChunks,
                    rows_processed: endIdx,
                    total_rows: totalRows,
                    progress_percent: round((endIdx / totalRows) * 100, 2),
                    estimated_time_remaining: this._estimateRemainingTime(chunkIdx + 1, totalChunks, startTime)
                });
            }
        }

        return {
            session_id: sessionId,
            total_chunks: totalChunks,
            total_rows: totalRows,
            chunk_files: processedChunks,
            output_dir: outputDir,
            completed_at: new Date().toISOString()
        };
    }

    /** Process a single chunk of data */
    async _processChunk(chunkRows, columns, targetLanguages, startRowOffset = 0) {
        const textColumn = this._getTextColumn(columns);
        const descriptionColumn = DESCRIPTION_COLUMNS.find((col) => columns.includes(col) && col !== textColumn) || null;

        const results = [];
        const pending = [];
        chunkRows.forEach((row, localIndex) => {
            const index = startRowOffset + localIndex;
            const sourceText = cellToString(row[textColumn]).trim();

            let description = '';
            if (descriptionColumn) {
                description = cellToString(row[descriptionColumn]).trim();
                if (isBlankText(description)) description = '';
            }

            if (isBlankText(sourceText)) {
                results.push({
                    index,
                    row: index + 1, // 1-based row number
                    source_text: sourceText,
                    description,
                    translations: {},
                    success: false,
                    error: 'Empty or invalid text'
                });
                return;
            }

            const entry = { index, row: index + 1, source_text: sourceText, description, translations: {}, success: false };
            results.push(entry);
            pending.push(entry);
        });

        // Translate to all target languages
        for (const targetLanguage of targetLanguages) {
            if (pending.length === 0) break;
            try {
                const translated = await this.translateBatchAsync(pending.map((e) => e.source_text), targetLanguage);
                pending.forEach((entry, i) => {
                    entry.translations[targetLanguage] = translated[i] ? translated[i].text : '[ERROR] Failed';
                });
            } catch (e) {
                pending.forEach((entry) => {
                    entry.translations[targetLanguage] = `[ERROR] ${e.message}`;
                });
            }
        }

        const timestamp = new Date().toISOString();
        for (const entry of pending) {
            entry.success = Object.keys(entry.translations).length > 0;
            entry.timestamp = timestamp;
        }

        return results;
    }

    /** Get the text column from the column list */
    _getTextColumn(columns) {
        for (const col of TEXT_COLUMNS) {
            if (columns.includes(col)) {
                return col;
            }
        }
        // Use first column if no standard text column found
        return columns[0];
    }

    /** Estimate remaining processing time */
    _estimateRemainingTime(completedChunks, totalChunks, startTime) {
        if (completedChunks === 0) {
            return 'Calculating...';
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const timePerChunk = elapsedSeconds / completedChunks;
        const remainingSeconds = (totalChunks - completedChunks) * timePerChunk;

        if (remainingSeconds < 60) {
            return `${Math.trunc(remainingSeconds)} seconds`;
        } else if (remainingSeconds < 3600) {
            return `${Math.trunc(remainingSeconds / 60)} minutes`;
        }
        return `${round(remainingSeconds / 3600, 1)} hours`;
    }

    /** Combine results from all processed chunks */
    async combineChunkResults(chunkFiles) {
        const allResults = [];
        for (const chunkFile of chunkFiles) {
            try {
                const chunkData = JSON.parse(await fs.readFile(chunkFile, 'utf8'));
                allResults.push(...chunkData);
            } catch (e) {
                // Silently continue on error
            }
        }
        return allResults;
    }

    /** Clean up temporary chunk files */
    async cleanupTempFiles(outputDir, sessionId) {
        try {
            const files = await fs.readdir(outputDir);
            const suffix = `_${sessionId}.json`;
            await Promise.all(files
                .filter((name) => name.startsWith('chunk_') && name.endsWith(suffix))
                .map((name) => fs.unlink(path.join(outputDir, name))));

            // Remove directory if empty
            if ((await fs.readdir(outputDir)).length === 0) {
                await fs.rmdir(outputDir);
            }
        } catch (e) {
            // Silently continue on error
        }
    }

    /** Validate large Excel file before processing */
    async validateLargeFile(buffer, fileSizeBytes = buffer.length) {
        try {
            const table = await readSpreadsheet(buffer);
            if (table.columns.length === 0) {
                return { success: false, error: 'Excel file is empty' };
            }

            const fileSizeMb = fileSizeBytes / (1024 * 1024);
            const totalRows = table.totalRows;

            return {
                success: true,
                file_size_mb: round(fileSizeMb, 2),
                total_rows: totalRows,
                columns: table.columns,
                text_column: this._getTextColumn(table.columns),
                sample_data: table.rows.slice(0, 3),
                recommendations: this._getFileRecommendations(totalRows, fileSizeMb)
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /** Get recommendations for processing large files */
    _getFileRecommendations(totalRows, fileSizeMb) {
        const recommendations = [];

        if (Number.isInteger(totalRows)) {
            if (totalRows > 100000) {
                recommendations.push('Consider using chunked processing for better performance');
                recommendations.push('Enable progress tracking to monitor translation status');
            }
            if (totalRows > 500000) {
                recommendations.push('Very large dataset - processing may take several hours');
                recommendations.push('Consider splitting file into smaller chunks for parallel processing');
            }
            if (totalRows > 1000000) {
                recommendations.push('Extremely large dataset - use background processing');
                recommendations.push('Consider processing during off-peak hours');
            }
        }

        if (fileSizeMb > 50) {
            recommendations.push('Large file size - ensure sufficient disk space for temporary files');
        }
        if (fileSizeMb > 100) {
            recommendations.push('Very large file - consider using streaming processing');
        }

        if (recommendations.length === 0) {
            recommendations.push('File size is optimal for standard processing');
        }

        return recommendations;
    }
}

// Global instance
const largeScaleTranslator = new LargeScaleTranslator();

module.exports = { LargeScaleTranslator, largeScaleTranslator, DESCRIPTION_COLUMNS, isBlankText };
