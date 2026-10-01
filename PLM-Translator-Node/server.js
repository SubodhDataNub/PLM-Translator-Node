#!/usr/bin/env node
/**
 * Entry point for the DN Translator application (local development and Azure App Service).
 */
'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { closeDb } = require('./models');
const { translatorService } = require('./services/translator');
const { terminology } = require('./services/terminology');

// Long-running mass translations: allow up to 30 minutes per request (like the gunicorn timeout)
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

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

async function main() {
    const app = await createApp();

    const server = app.listen(config.port, () => {
        console.log(`DN Translator running on http://localhost:${config.port} (${config.environment})`);
        console.log(`Translation provider: ${describeTranslator()}`);
        // Read the label terminology now rather than on the first translation
        setImmediate(() => terminology.load());
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;

    const shutdown = (signal) => {
        console.log(`${signal} received, shutting down...`);
        server.close(async () => {
            await closeDb();
            process.exit(0);
        });
        // Force exit if connections do not close in time
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    console.error('Failed to start DN Translator:', err);
    process.exit(1);
});
