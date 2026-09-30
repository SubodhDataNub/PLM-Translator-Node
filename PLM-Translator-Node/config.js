/**
 * Configuration module for DN Translator application.
 * Handles database connections, environment variables, and app settings.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const ROOT_DIR = __dirname;
const DEFAULT_SQLITE_PATH = path.join(ROOT_DIR, 'data', 'plm_translator.db');

function intFromEnv(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

/** Determine the current environment type */
function getEnvironmentType() {
    if (process.env.WEBSITE_SITE_NAME) {
        return 'production';
    } else if (process.env.NODE_ENV === 'production') {
        return 'production';
    } else if (process.env.NODE_ENV === 'development') {
        return 'development';
    } else if (process.env.TESTING) {
        return 'testing';
    }
    return 'development'; // Default to development
}

// ---------------------------------------------------------------------------
// Database configuration
// ---------------------------------------------------------------------------

function sqliteConfig(filename) {
    return {
        client: 'sqlite3',
        connection: { filename },
        useNullAsDefault: true
    };
}

function mssqlConfig({ server, database, user, password, port, encrypt = true, trustServerCertificate = false }) {
    return {
        client: 'mssql',
        connection: {
            server,
            database,
            user,
            password,
            port: port || 1433,
            encrypt,
            connectionTimeout: 30000,
            requestTimeout: 300000, // Large exports can take a while
            options: { trustServerCertificate }
        },
        pool: { min: 0, max: 10 }
    };
}

function isTruthy(value) {
    return ['true', 'yes', '1'].includes(String(value || '').trim().toLowerCase());
}

/**
 * Parse an ADO.NET style connection string, e.g. the one Azure App Service exposes as
 * SQLAZURECONNSTR_DefaultConnection:
 *   Server=tcp:myserver.database.windows.net,1433;Initial Catalog=mydb;User ID=me;Password=...;Encrypt=True;
 */
function parseAdoConnectionString(connStr) {
    const parts = {};
    for (const segment of connStr.split(';')) {
        const idx = segment.indexOf('=');
        if (idx === -1) continue;
        parts[segment.slice(0, idx).trim().toLowerCase()] = segment.slice(idx + 1).trim();
    }

    let server = parts['server'] || parts['data source'] || parts['address'] || parts['addr'] || '';
    server = server.replace(/^tcp:/i, '');
    let port;
    if (server.includes(',')) {
        [server, port] = server.split(',');
        port = parseInt(port, 10);
    }

    return mssqlConfig({
        server,
        port,
        database: parts['initial catalog'] || parts['database'],
        user: parts['user id'] || parts['uid'] || parts['user'],
        password: parts['password'] || parts['pwd'],
        encrypt: parts['encrypt'] === undefined ? true : isTruthy(parts['encrypt']),
        trustServerCertificate: isTruthy(parts['trustservercertificate'])
    });
}

/**
 * Parse DATABASE_URL. Accepts SQLAlchemy-style URLs used by the Python version
 * (sqlite:///path, mssql+pyodbc://user:pass@host/db) as well as ADO.NET connection strings.
 */
function parseDatabaseUrl(databaseUrl) {
    if (/^\s*(server|data source)\s*=/i.test(databaseUrl)) {
        return parseAdoConnectionString(databaseUrl);
    }

    const sqliteMatch = databaseUrl.match(/^sqlite:(?:\/\/)?(.*)$/i);
    if (sqliteMatch) {
        // sqlite:///relative.db -> "/relative.db" ; sqlite:////abs/path.db -> "//abs/path.db"
        let filename = sqliteMatch[1];
        if (filename.startsWith('/')) filename = filename.slice(1);
        if (/^\/[A-Za-z]:/.test(filename)) filename = filename.slice(1); // sqlite:////C:/path.db
        if (!filename || filename === ':memory:') return sqliteConfig(':memory:');
        return sqliteConfig(path.isAbsolute(filename) ? filename : path.join(ROOT_DIR, filename));
    }

    if (/^(mssql|sqlserver)(\+[a-z]+)?:\/\//i.test(databaseUrl)) {
        const url = new URL(databaseUrl.replace(/^[a-z+]+:/i, 'http:'));
        const params = Object.fromEntries(
            [...url.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v])
        );
        return mssqlConfig({
            server: url.hostname,
            port: url.port ? parseInt(url.port, 10) : undefined,
            database: decodeURIComponent(url.pathname.replace(/^\//, '')),
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            encrypt: params.encrypt === undefined ? true : isTruthy(params.encrypt),
            trustServerCertificate: isTruthy(params.trustservercertificate)
        });
    }

    throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl.split(':')[0]}. Use sqlite or mssql.`);
}

function getAzureSqlConfig() {
    const server = process.env.AZURE_SQL_SERVER;
    const database = process.env.AZURE_SQL_DATABASE;
    const user = process.env.AZURE_SQL_USERNAME;
    const password = process.env.AZURE_SQL_PASSWORD;

    if (server && database && user && password) {
        return mssqlConfig({ server, database, user, password });
    }
    return null;
}

/** Get database configuration for production (Azure SQL Database) */
function getProductionDatabaseConfig() {
    // Check if running on Azure App Service with a connection string configured
    if (process.env.WEBSITE_SITE_NAME && process.env.SQLAZURECONNSTR_DefaultConnection) {
        return parseAdoConnectionString(process.env.SQLAZURECONNSTR_DefaultConnection);
    }

    // Check if explicit DATABASE_URL is provided
    if (process.env.DATABASE_URL) {
        return parseDatabaseUrl(process.env.DATABASE_URL);
    }

    // Check if Azure SQL Database components are provided
    const azureConfig = getAzureSqlConfig();
    if (azureConfig) {
        return azureConfig;
    }

    throw new Error(
        'Azure SQL Database configuration not found. Please set the required environment variables: ' +
        'AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USERNAME, AZURE_SQL_PASSWORD'
    );
}

/** Get database configuration for development - supports SQLite and Azure SQL */
function getDevelopmentDatabaseConfig() {
    if (process.env.DATABASE_URL) {
        return parseDatabaseUrl(process.env.DATABASE_URL);
    }

    if ((process.env.DATABASE_TYPE || '').toLowerCase() === 'sqlite') {
        return sqliteConfig(process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH);
    }

    const azureConfig = getAzureSqlConfig();
    if (azureConfig) {
        return azureConfig;
    }

    // Nothing configured: use the local SQLite database so the app runs out of the box
    console.warn(`No database configured - using local SQLite database at ${DEFAULT_SQLITE_PATH}`);
    return sqliteConfig(DEFAULT_SQLITE_PATH);
}

function getDatabaseConfig(environment) {
    if (environment === 'production') return getProductionDatabaseConfig();
    if (environment === 'testing') return sqliteConfig(':memory:');
    return getDevelopmentDatabaseConfig();
}

// ---------------------------------------------------------------------------
// Google Cloud Translation configuration
// ---------------------------------------------------------------------------

/**
 * Google Cloud Translation API configuration.
 *
 * Two authentication options are supported:
 *  - Service account / ADC (GOOGLE_CLOUD_PROJECT_ID) -> Cloud Translation Advanced (v3),
 *    using the Translation LLM model by default
 *  - API key (GOOGLE_TRANSLATE_API_KEY)            -> Cloud Translation Basic (v2),
 *    standard model only (Basic has no LLM)
 * When both are configured, Advanced is used.
 */
const DEFAULT_MODEL = 'general/translation-llm';

class GoogleTranslateConfig {
    static load() {
        let credentials = null;
        if (process.env.GOOGLE_CREDENTIALS_JSON) {
            try {
                credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            } catch (e) {
                console.error(`GOOGLE_CREDENTIALS_JSON is not valid JSON: ${e.message}`);
            }
        }

        const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || null;
        const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID
            || process.env.GOOGLE_CLOUD_PROJECT
            || (credentials && credentials.project_id)
            || null;

        // Prefer Advanced: it is the only edition with the Translation LLM
        let edition = null;
        if (projectId) {
            edition = 'advanced';
        } else if (apiKey) {
            edition = 'basic';
        }

        return {
            edition,
            apiKey,
            projectId,
            location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
            credentials,
            // Set GOOGLE_TRANSLATE_MODEL=general/nmt to use the standard model instead
            model: process.env.GOOGLE_TRANSLATE_MODEL || DEFAULT_MODEL,
            // Batching / rate limiting
            maxCharsPerRequest: intFromEnv('TRANSLATE_MAX_CHARS_PER_REQUEST', 5000),
            requestDelayMs: intFromEnv('TRANSLATE_REQUEST_DELAY_MS', 250),
            maxRetries: intFromEnv('TRANSLATE_MAX_RETRIES', 5)
        };
    }

    static isConfigured(cfg) {
        return Boolean(cfg && cfg.edition);
    }
}

const environment = getEnvironmentType();

module.exports = {
    ROOT_DIR,
    environment,
    getEnvironmentType,
    getDatabaseConfig,
    parseDatabaseUrl,
    parseAdoConnectionString,
    GoogleTranslateConfig,
    port: intFromEnv('PORT', 5000),
    massTranslateBatchSize: intFromEnv('TRANSLATE_BATCH_SIZE', 25),
    maxUploadMb: intFromEnv('MAX_UPLOAD_MB', 200),
    largeScale: {
        chunkSize: intFromEnv('LST_CHUNK_SIZE', 1000),
        maxWorkers: intFromEnv('LST_MAX_WORKERS', 10),
        batchSize: intFromEnv('LST_BATCH_SIZE', 25),
        maxRetries: intFromEnv('LST_MAX_RETRIES', 3)
    }
};
