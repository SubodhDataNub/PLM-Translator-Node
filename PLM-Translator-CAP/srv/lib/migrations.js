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

// Single translations used to get a session ID of their own, which only linked
// them to their "Saved result" activity. They now have none, and the activity
// points at the translation directly. Session IDs are kept for mass translation
// runs, where they group every row of the run.
async function migrateSingleSessions(db, log) {
    const { TestResults, ActivityLog, MassTranslations } = cds.entities('plm.translator');
    const runs = new Set((await db.run(SELECT.from(MassTranslations).columns('sessionId')
        .where`sessionId is not null`)).map((row) => row.sessionId));
    const candidates = await db.run(SELECT.from(TestResults)
        .columns('ID', 'sessionId', 'modifiedAt', 'modifiedBy')
        .where`sessionId is not null and not sessionId like 'mass_translation_%'`);
    const singles = candidates.filter((row) => !runs.has(row.sessionId));

    for (const row of singles) {
        const activities = await db.run(SELECT.from(ActivityLog)
            .columns('ID', 'modifiedAt', 'modifiedBy').where({ sessionId: row.sessionId }));
        for (const activity of activities) {
            await db.run(UPDATE(ActivityLog).set({
                sessionId: null,
                translation_ID: row.ID,
                modifiedAt: activity.modifiedAt,
                modifiedBy: activity.modifiedBy
            }).where({ ID: activity.ID }));
        }
        await db.run(UPDATE(TestResults).set({
            sessionId: null,
            modifiedAt: row.modifiedAt,
            modifiedBy: row.modifiedBy
        }).where({ ID: row.ID }));
    }
    if (singles.length) log.info(`Removed the session ID from ${singles.length} single translations`);
}

async function migrateData() {
    const log = cds.log('db');
    try {
        const db = await cds.connect.to('db');
        await db.tx((tx) => migrateTestResultKeys(tx, log));
        await db.tx((tx) => migrateSingleSessions(tx, log));
    } catch (e) {
        log.error(`Data migration failed: ${e.message}`);
    }
}

module.exports = { migrateData };
