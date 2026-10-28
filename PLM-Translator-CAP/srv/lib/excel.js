'use strict';

const ExcelJS = require('exceljs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class ExcelReadError extends Error {}

function formatDate(date) {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

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

function cellToString(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return formatDate(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return String(value);
}

function isEmptyValue(value) {
    return value === '' || value === null || value === undefined;
}

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

function autoFitColumns(worksheet) {
    worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
            maxLength = Math.max(maxLength, displayLength(cell.value));
        });
        column.width = Math.min(maxLength + 2, 50);
    });
}

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
