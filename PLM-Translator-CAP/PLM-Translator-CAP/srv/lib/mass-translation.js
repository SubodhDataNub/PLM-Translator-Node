'use strict';

const { ExcelJS, readSpreadsheet, cellToString, addRecordsSheet } = require('./excel');
const { parseLanguageCode, round } = require('./utils');

const TEXT_COLUMNS = ['Phrase Text', 'phrase text', 'PHRASE TEXT', 'text', 'Text', 'TEXT',
    'content', 'Content', 'CONTENT', 'message', 'Message', 'MESSAGE'];
const VALIDATION_TEXT_COLUMNS = ['text', 'Text', 'TEXT', 'content', 'Content', 'CONTENT',
    'message', 'Message', 'MESSAGE', 'description', 'Description'];
const DESCRIPTION_COLUMNS = ['description', 'Description', 'DESCRIPTION', 'desc', 'Desc', 'notes', 'Notes'];

function isBlankText(text) {
    return !text || ['nan', 'none', ''].includes(text.toLowerCase());
}

function isExcelFilename(filename) {
    return /\.(xlsx|xls)$/i.test(filename || '');
}

function findTextColumn(columns, candidates = TEXT_COLUMNS) {
    return candidates.find((col) => columns.includes(col)) || columns[0];
}

function findDescriptionColumn(columns, textColumn) {
    return DESCRIPTION_COLUMNS.find((col) => columns.includes(col) && col !== textColumn) || null;
}

function collectTexts(table) {
    const textColumn = findTextColumn(table.columns);
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

function processingRecommendation(recordCount, languageCount = 1) {
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

function estimateProcessingTime(recordCount, languageCount = 1) {
    const estimatedMinutes = (recordCount * languageCount) / 1000;
    return {
        estimatedMinutes,
        estimatedHours: estimatedMinutes / 60,
        recordCount,
        languageCount,
        recommendation: processingRecommendation(recordCount, languageCount)
    };
}

function fileRecommendations(totalRows, fileSizeMb) {
    const recommendations = [];
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

async function validateWorkbook(buffer, languageCount = 1) {
    const table = await readSpreadsheet(buffer);
    if (table.columns.length === 0) {
        throw new Error('Excel file is empty');
    }
    const fileSizeMb = buffer.length / (1024 * 1024);
    return {
        fileSizeMb: round(fileSizeMb, 2),
        totalRows: table.totalRows,
        columns: table.columns,
        textColumn: findTextColumn(table.columns, VALIDATION_TEXT_COLUMNS),
        sampleData: JSON.stringify(table.rows.slice(0, 3)),
        recommendations: fileRecommendations(table.totalRows, fileSizeMb),
        timeEstimates: estimateProcessingTime(table.totalRows, languageCount)
    };
}

const MASS_OBSERVATION_ROW = /^Mass translation(?: FAILED)? - Row (\d+)/;

function isFailureOutcome(outcome) {
    return ['failure', 'failed'].includes(String(outcome || '').toLowerCase());
}

function parseMassObservation(record) {
    const observation = record.observation || '';
    if (!isFailureOutcome(record.outcome)) {
        const match = observation.match(/^Mass translation - Row \d+(?: - ([\s\S]*))?$/);
        return { description: match && match[1] ? match[1] : '', error: '' };
    }

    const errorMessage = (record.translatedText || '').replace(/^ERROR: /, '');
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

function buildSessionResultSheet(records, languagesList) {
    const languageMap = {};
    for (const lang of languagesList) {
        if (lang.key) languageMap[lang.key] = lang.text;
    }

    const languageHeaders = new Map();
    const groups = new Map();

    records.forEach((record, i) => {
        const match = (record.observation || '').match(MASS_OBSERVATION_ROW);
        const rowNum = match ? parseInt(match[1], 10) : i + 1;
        const key = match ? `row:${rowNum}` : `id:${record.ID}`;

        const code = parseLanguageCode(record.targetLanguage, languagesList);
        if (!languageHeaders.has(code)) {
            const storedName = (record.targetLanguage || '').slice(code.length + 1);
            const name = languageMap[code] || storedName || code.toUpperCase();
            languageHeaders.set(code, `${name} (${code.toUpperCase()})`);
        }

        let group = groups.get(key);
        if (!group) {
            group = { row: rowNum, sourceText: record.textToTranslate || '', description: '', translations: {}, errors: {} };
            groups.set(key, group);
        }

        const { description, error } = parseMassObservation(record);
        if (description && !group.description) group.description = description;
        if (isFailureOutcome(record.outcome)) {
            group.errors[code] = error;
        } else {
            group.translations[code] = record.translatedText || '';
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

function sessionResultsWorkbook(records, languagesList) {
    const sheet = buildSessionResultSheet(records, languagesList);
    const workbook = new ExcelJS.Workbook();
    const worksheet = addRecordsSheet(workbook, 'Translation Results', sheet.records, { columns: sheet.columns });

    worksheet.views = [{ state: 'frozen', xSplit: sheet.frozenColumns, ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) row.alignment = { wrapText: true, vertical: 'top' };
    });
    return workbook;
}

function templateWorkbook() {
    const workbook = new ExcelJS.Workbook();

    const worksheet = addRecordsSheet(workbook, 'Translation Data', [
        { 'Phrase Text': 'Hello, how are you?' },
        { 'Phrase Text': 'Thank you for your help.' },
        { 'Phrase Text': 'Please review this document.' }
    ]);
    worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' }, bgColor: { argb: 'FF366092' } };
    });

    const instructions = [
        'Mass Translation Template Instructions',
        '',
        'How to use this template:',
        '1. Replace the sample data with your own text to translate',
        '2. Keep the column headers as they are',
        '3. Supported column names: text, content, message, description',
        '4. You can use either "text" or "description" column (or both)',
        '5. Maximum 5000 characters per text entry',
        '6. Save the file as .xlsx format',
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
    instructions.forEach((line) => instructionsWs.addRow([line]));
    instructionsWs.getColumn('A').width = 80;
    instructionsWs.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF366092' } };

    return workbook;
}

module.exports = {
    isExcelFilename,
    collectTexts,
    observationFor,
    estimateProcessingTime,
    validateWorkbook,
    isFailureOutcome,
    sessionResultsWorkbook,
    templateWorkbook
};
