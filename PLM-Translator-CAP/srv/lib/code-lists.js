'use strict';

const cds = require('@sap/cds');
const { translatorService } = require('./translator');

const OUTCOMES = [
    { code: 'Success', name: 'Success', criticality: 3 },
    { code: 'Partial', name: 'Partial', criticality: 2 },
    { code: 'Failure', name: 'Failed', criticality: 1 }
];

const ACTIVITY_TYPES = [
    { code: 'translate', name: 'Translation' },
    { code: 'save', name: 'Saved result' },
    { code: 'massTranslate', name: 'Mass translation' },
    { code: 'export', name: 'Export' },
    { code: 'download', name: 'Download' }
];

async function syncLanguages() {
    const { Languages } = cds.entities('plm.translator');
    const languages = (await translatorService.getSupportedLanguages()).filter((lang) => lang.key);
    const rows = languages.map((lang) => ({
        code: lang.key,
        name: lang.text || lang.key,
        label: `${lang.key}-${lang.text || lang.key}`
    }));
    if (rows.length) await UPSERT.into(Languages).entries(rows);
}

async function syncCodeLists() {
    const log = cds.log('translator');
    const { Outcomes, ActivityTypes } = cds.entities('plm.translator');
    try {
        await UPSERT.into(Outcomes).entries(OUTCOMES);
        await UPSERT.into(ActivityTypes).entries(ACTIVITY_TYPES);
        await syncLanguages();
    } catch (e) {
        log.warn(`Could not load code lists: ${e.message}`);
    }
}

module.exports = { syncCodeLists, syncLanguages };
