'use strict';

const cds = require('@sap/cds');

async function migrateTestResultKeys(db, log) {
    const { TestResults } = cds.entities('plm.translator');
    const legacy = await db.run(SELECT.from(TestResults).columns('ID', 'createdAt', 'createdBy').where`length(ID) < 36`);
    for (const row of legacy) {
        await db.run(UPDATE(TestResults).set({
            ID: cds.utils.uuid(),
            modifiedAt: row.createdAt,
            modifiedBy: row.createdBy
        }).where({ ID: row.ID }));
    }
    if (legacy.length) log.info(`Gave ${legacy.length} test results a UUID key`);

    const drafts = cds.entities('TranslatorService')['TestResults.drafts'];
    if (drafts) {
        const stale = await db.run(DELETE.from(drafts).where`length(ID) < 36`);
        if (stale) log.info(`Removed ${stale} test result drafts with an old key`);
    }
}

async function migrateData() {
    const log = cds.log('db');
    try {
        const db = await cds.connect.to('db');
        await db.tx((tx) => migrateTestResultKeys(tx, log));
    } catch (e) {
        log.error(`Data migration failed: ${e.message}`);
    }
}

module.exports = { migrateData };
