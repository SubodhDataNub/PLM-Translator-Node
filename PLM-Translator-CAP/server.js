'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');
const { translatorService } = require('./srv/lib/translator');
const { terminology } = require('./srv/lib/terminology');
const { syncCodeLists } = require('./srv/lib/code-lists');

const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

const LAUNCHPAD = '/launchpage.html';
const APPS = ['translations', 'masstranslation', 'activity'];
const PAGES = {
    '/': LAUNCHPAD,
    '/index.html': LAUNCHPAD,
    '/mass-translation': `${LAUNCHPAD}#MassTranslation-manage`,
    '/test-results': `${LAUNCHPAD}#TestResult-manage`
};

const isSqlite = cds.env.requires.db && cds.env.requires.db.kind === 'sqlite';

const dbUrl = isSqlite && cds.env.requires.db.credentials && cds.env.requires.db.credentials.url;
if (dbUrl && dbUrl !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(cds.root, dbUrl)), { recursive: true });
}

cds.on('bootstrap', (app) => {
    for (const name of APPS) {
        app.use(`/${name}/webapp/odata`, (req, res) => res.redirect(307, `/odata${req.url}`));
    }
    for (const [route, file] of Object.entries(PAGES)) {
        app.get(route, (req, res) => res.redirect(file));
    }
});

const COLUMN_LINE = /^\s+("?)(\w+)\1 (.+?)( NOT NULL)?,?$/;

async function upgradeSqliteSchema(db) {
    const log = cds.log('db');
    const statements = cds.compile.to.sql(await cds.load('*', { silent: true }), { dialect: 'sqlite' });
    for (const statement of statements) {
        const table = /^CREATE TABLE (\S+) \(/.exec(statement);
        if (table) {
            const name = table[1];
            const columns = await db.run(`PRAGMA table_info(${name})`);
            if (!columns.length) {
                log.info(`Creating table ${name}`);
                await db.run(statement);
                continue;
            }
            const existing = new Set(columns.map((column) => column.name.toLowerCase()));
            for (const line of statement.split('\n').slice(1)) {
                const column = COLUMN_LINE.exec(line);
                if (!column || /^\s*PRIMARY KEY/.test(line) || existing.has(column[2].toLowerCase())) continue;
                log.info(`Adding column ${name}.${column[2]}`);
                await db.run(`ALTER TABLE ${name} ADD COLUMN ${column[1]}${column[2]}${column[1]} ${column[3]}`);
            }
            continue;
        }
        const view = /^CREATE VIEW (\S+) AS/.exec(statement);
        if (view) {
            await db.run(`DROP VIEW IF EXISTS ${view[1]}`);
            await db.run(statement);
        }
    }
}

cds.on('served', async () => {
    if (isSqlite) await upgradeSqliteSchema(await cds.connect.to('db'));
    await syncCodeLists();
});

function describeTranslator() {
    if (translatorService.isConfigured()) {
        return 'Google Cloud Translation Basic (v2) - NMT model via BTP destination';
    }
    return 'NOT CONFIGURED - create the google-translation destination with X-Goog-Api-Key header';
}

cds.on('listening', ({ server, url }) => {
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    console.log(`DN Translator (CAP) running on ${url}`);
    console.log(`Translation provider: ${describeTranslator()}`);
    setImmediate(() => terminology.load());
});

module.exports = cds.server;
