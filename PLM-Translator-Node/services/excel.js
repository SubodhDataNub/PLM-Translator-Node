/**
 * Excel helpers (replacement for pandas + openpyxl).
 * Reads uploaded workbooks into a simple table and builds downloadable .xlsx files.
 */
'use strict';

const ExcelJS = require('exceljs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class ExcelReadError extends Error {}

/** Format a Date like pandas' str(Timestamp): 'YYYY-MM-DD HH:MM:SS' */
function formatDate(date) {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Convert an ExcelJS cell value into a plain JS value ('' for empty cells, like fillna('')) */
function cellValue(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value;
    if (typeof value !== 'object') return value;

    if (Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('');
    }
    if ('result' in value || 'formula' in value || 'sharedFormula' in value) {
        return value.result === undefined ? '' : cellValue(value.result);
    }
    if ('text' in value) {
        return cellValue(value.text);
    }
    if ('error' in value) {
        return value.error;
    }
    return String(value);
}

/** Convert a cell value to text the way Python's str() did */
function cellToString(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return formatDate(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return String(value);
}

function isEmptyValue(value) {
    return value === '' || value === null || value === undefined;
}

/**
 * Read the first worksheet of an .xlsx file into a table.
 * The first row is used as the header (like pandas.read_excel).
 *
 * @param {Buffer} buffer
 * @param {{maxRows?: number}} options - maxRows limits how many data rows are returned
 * @returns {Promise<{columns: string[], rows: object[], totalRows: number}>}
 */
async function readSpreadsheet(buffer, { maxRows = Infinity } = {}) {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
    } catch (e) {
        throw new ExcelReadError(
            'Unable to read the file as an .xlsx workbook. Legacy .xls files are not supported - ' +
            `please save the file as .xlsx and try again. (${e.message})`
        );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) {
        return { columns: [], rows: [], totalRows: 0 };
    }

    // Find the last row/column that contain data (trailing empty rows/columns are ignored)
    let lastRow = 1;
    let columnCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            if (!isEmptyValue(cellValue(cell.value))) {
                lastRow = Math.max(lastRow, rowNumber);
                columnCount = Math.max(columnCount, colNumber);
            }
        });
    });

    // Build column names from the header row (pandas-style naming for blanks/duplicates)
    const headerRow = worksheet.getRow(1);
    const columns = [];
    const seen = new Map();
    for (let c = 1; c <= columnCount; c++) {
        let name = cellToString(cellValue(headerRow.getCell(c).value)).trim();
        if (!name) name = `Unnamed: ${c - 1}`;
        if (seen.has(name)) {
            const count = seen.get(name) + 1;
            seen.set(name, count);
            name = `${name}.${count}`;
        } else {
            seen.set(name, 0);
        }
        columns.push(name);
    }

    const totalRows = lastRow - 1;
    const rows = [];
    const rowsToRead = Math.min(totalRows, maxRows);
    for (let r = 2; r < 2 + rowsToRead; r++) {
        const excelRow = worksheet.getRow(r);
        const record = {};
        columns.forEach((name, idx) => {
            record[name] = cellValue(excelRow.getCell(idx + 1).value);
        });
        rows.push(record);
    }

    return { columns, rows, totalRows };
}

function displayLength(value) {
    if (value === null || value === undefined) return 0;
    return cellToString(value).length;
}

/** Auto-adjust column widths: min(max content length + 2, 50) */
function autoFitColumns(worksheet) {
    worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
            maxLength = Math.max(maxLength, displayLength(cell.value));
        });
        column.width = Math.min(maxLength + 2, 50);
    });
}

/**
 * Add a sheet built from a list of records (like DataFrame.to_excel(index=False)).
 * Columns are the union of record keys, in order of first appearance.
 */
function addRecordsSheet(workbook, sheetName, records, { columns = null } = {}) {
    const worksheet = workbook.addWorksheet(sheetName);

    let headers = columns;
    if (!headers) {
        const ordered = new Set();
        records.forEach((record) => Object.keys(record).forEach((key) => ordered.add(key)));
        headers = [...ordered];
    }

    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true };
    records.forEach((record) => {
        worksheet.addRow(headers.map((key) => {
            const value = record[key];
            return value === undefined ? null : value;
        }));
    });

    autoFitColumns(worksheet);
    return worksheet;
}

async function workbookToBuffer(workbook) {
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Send a workbook as an .xlsx download */
async function sendWorkbook(res, workbook, filename) {
    const buffer = await workbookToBuffer(workbook);
    res.attachment(filename);
    res.type(XLSX_MIME);
    res.send(buffer);
}

module.exports = {
    ExcelJS,
    ExcelReadError,
    XLSX_MIME,
    readSpreadsheet,
    cellToString,
    autoFitColumns,
    addRecordsSheet,
    workbookToBuffer,
    sendWorkbook
};
