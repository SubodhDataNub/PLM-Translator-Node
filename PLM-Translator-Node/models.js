/**
 * Database models for DN Translator application.
 * Contains the Knex connection and the test_results table schema/helpers.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const knex = require('knex');

const TABLE = 'test_results';

let db = null;

function isMssql() {
    return db && db.client.config.client === 'mssql';
}

function isSqlite() {
    return db && db.client.config.client === 'sqlite3';
}

/**
 * Serialize a Date for storage.
 * SQL Server and PostgreSQL: pass the Date through (bound as a timestamp, UTC).
 * SQLite: store as 'YYYY-MM-DD HH:MM:SS.ffffff' (UTC), the same format SQLAlchemy used,
 * so rows written by the Python and Node versions sort and parse consistently.
 */
function serializeDate(date) {
    if (!isSqlite()) return date;
    return date.toISOString().replace('T', ' ').replace('Z', '000');
}

/** Parse a created_at value read from the database into a Date (UTC) */
function parseDbDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);

    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/
    );
    if (!match) {
        const fallback = new Date(value);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    }
    const [, y, mo, d, h, mi, s, frac = '0', tz] = match;
    const ms = parseInt(frac.padEnd(3, '0').slice(0, 3), 10);
    let time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
    if (tz && tz !== 'Z') {
        const sign = tz[0] === '-' ? -1 : 1;
        const digits = tz.slice(1).replace(':', '');
        time -= sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2), 10)) * 60000;
    }
    return new Date(time);
}

/** Format a Date the way Python's naive datetime.isoformat() did (UTC, no timezone suffix) */
function isoformat(date) {
    return date ? date.toISOString().replace('Z', '') : null;
}

/** Normalize a raw database row into a TestResult object */
function toTestResult(row) {
    if (!row) return null;
    return {
        id: row.id,
        outcome: row.outcome,
        accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
        observation: row.observation,
        tested_by: row.tested_by,
        text_to_translate: row.text_to_translate,
        translated_text: row.translated_text,
        source_language: row.source_language,
        target_language: row.target_language,
        session_id: row.session_id,
        created_at: parseDbDate(row.created_at)
    };
}

/** Convert TestResult to a plain dictionary for JSON serialization */
function toDict(result) {
    return {
        id: result.id,
        outcome: result.outcome,
        accuracy: result.accuracy,
        observation: result.observation,
        tested_by: result.tested_by,
        text_to_translate: result.text_to_translate,
        translated_text: result.translated_text,
        source_language: result.source_language,
        target_language: result.target_language,
        session_id: result.session_id,
        created_at: isoformat(result.created_at)
    };
}

/** Prepare a TestResult record for insertion (applies created_at default) */
function toInsertRow(record) {
    return {
        outcome: record.outcome,
        accuracy: record.accuracy,
        observation: record.observation ?? null,
        tested_by: record.tested_by ?? null,
        text_to_translate: record.text_to_translate ?? null,
        translated_text: record.translated_text ?? null,
        source_language: record.source_language ?? null,
        target_language: record.target_language ?? null,
        session_id: record.session_id ?? null,
        created_at: serializeDate(record.created_at || new Date())
    };
}

/** Insert a single test result and return the saved record */
async function createTestResult(record) {
    const inserted = await db(TABLE).insert(toInsertRow(record)).returning('id');
    const id = typeof inserted[0] === 'object' ? inserted[0].id : inserted[0];
    return getTestResult(id);
}

/** Bulk insert test results in a single transaction */
async function bulkInsertTestResults(records, chunkSize = 100) {
    // 100 rows x 10 columns keeps each statement under SQL Server's 2100 parameter limit
    await db.batchInsert(TABLE, records.map(toInsertRow), chunkSize);
}

async function getTestResult(id) {
    const row = await db(TABLE).where({ id }).first();
    return toTestResult(row);
}

/**
 * Add a case-insensitive LIKE condition (equivalent of SQLAlchemy's ilike on SQLite/SQL Server).
 * Both sides are lowercased by the database so they are always normalized the same way
 * (SQLite's LOWER() only folds ASCII characters).
 */
function whereILike(qb, column, pattern, method = 'whereRaw') {
    return qb[method]('LOWER(??) LIKE LOWER(?)', [column, pattern]);
}

/** Create the test_results table if it does not exist */
async function createTables() {
    const exists = await db.schema.hasTable(TABLE);
    if (exists) return;

    await db.schema.createTable(TABLE, (table) => {
        table.increments('id').primary();
        table.string('outcome', 50).notNullable();          // Success/Partial/Failure
        table.float('accuracy').notNullable();               // Percentage accuracy
        table.text('observation');                           // User observations (Unicode)
        table.string('tested_by', 100);                      // Who tested it
        table.text('text_to_translate');                     // Original text (Unicode)
        table.text('translated_text');                       // Translated text (Unicode)
        table.string('source_language', 100);                // Source language code
        table.string('target_language', 100);                // Target language 'code-Name'
        table.string('session_id', 100);                     // Session identifier
        table.dateTime('created_at');                        // When created (UTC)
    });
}

/** Update existing SQL Server columns to support Unicode properly */
async function updateDatabaseForUnicode() {
    if (!isMssql()) return;
    try {
        if (!(await db.schema.hasTable(TABLE))) return;
        const [{ count }] = await db(TABLE).count('* as count');
        if (Number(count) > 0) {
            await db.transaction(async (trx) => {
                await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN observation NVARCHAR(MAX)`);
                await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN text_to_translate NVARCHAR(MAX)`);
                await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN translated_text NVARCHAR(MAX)`);
            });
        }
    } catch (e) {
        // Silently continue on error
    }
}

/** Initialize database connection and schema */
async function initDb(databaseConfig) {
    const filename = databaseConfig.connection && databaseConfig.connection.filename;
    if (databaseConfig.client === 'sqlite3' && filename && filename !== ':memory:') {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
    }

    db = knex(databaseConfig);

    try {
        // First, try to update existing tables for Unicode (for SQL Server)
        await updateDatabaseForUnicode();
    } catch (e) {
        // Ignore and continue to table creation
    }
    await createTables();
    return db;
}

function getDb() {
    if (!db) throw new Error('Database has not been initialized. Call initDb() first.');
    return db;
}

async function closeDb() {
    if (db) {
        await db.destroy();
        db = null;
    }
}

module.exports = {
    TABLE,
    initDb,
    getDb,
    closeDb,
    toTestResult,
    toDict,
    createTestResult,
    bulkInsertTestResults,
    getTestResult,
    whereILike,
    parseDbDate
};
