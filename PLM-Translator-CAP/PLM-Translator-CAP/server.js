/**
 * Custom CAP server for DN Translator.
 * - creates the SQLite database file and its tables on first start
 * - serves the pages under the same paths as the Node.js version
 * - allows long-running mass translation requests
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');
const { translatorService } = require('./srv/lib/translator');
const { terminology } = require('./srv/lib/terminology');

// Long-running mass translations: allow up to 30 minutes per request
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

const PAGES = {
    '/mass-translation': '/mass-translation.html',
    '/test-results': '/test-results.html'
};

// The SQLite driver does not create missing folders
const dbUrl = cds.env.requires.db && cds.env.requires.db.credentials && cds.env.requires.db.credentials.url;
if (dbUrl && dbUrl !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(cds.root, dbUrl)), { recursive: true });
}

cds.on('bootstrap', (app) => {
    for (const [route, file] of Object.entries(PAGES)) {
        app.get(route, (req, res) => res.redirect(file));
    }
});

// Create the tables when the database is new; existing data is never dropped
cds.on('served', async () => {
    const db = await cds.connect.to('db');
    const table = await db.run(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plm_translator_TestResults'"
    );
    if (!table.length) {
        cds.log('db').info('Creating database tables');
        await cds.deploy(cds.model).to(db);
    }
});

function describeTranslator() {
    const cfg = translatorService.config;
    if (cfg.edition === 'advanced') {
        return `Google Cloud Translation Advanced (v3) - project ${cfg.projectId}, location ${cfg.location}, model ${cfg.model}`;
    }
    if (cfg.edition === 'basic') {
        return 'Google Cloud Translation Basic (v2) - API key, standard model (the Translation LLM needs Advanced)';
    }
    return 'NOT CONFIGURED - set GOOGLE_TRANSLATE_API_KEY or GOOGLE_CLOUD_PROJECT_ID (see .env.example)';
}

cds.on('listening', ({ server, url }) => {
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    console.log(`DN Translator (CAP) running on ${url}`);
    console.log(`Translation provider: ${describeTranslator()}`);
    // Read the label terminology now rather than on the first translation
    setImmediate(() => terminology.load());
});

module.exports = cds.server;
