/**
 * DN Translator Express Application
 * A modular Express web application for language translation using Google Cloud Translation API.
 */
'use strict';

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const config = require('./config');
const { initDb } = require('./models');
const { registerRoutes } = require('./routes');
const { strftime, printf } = require('./utils');

const ENDPOINTS = {
    'main.index': '/',
    'main.mass_translation': '/mass-translation',
    'main.view_test_results': '/test-results'
};

/**
 * Build a URL for an endpoint (template equivalent of Flask's url_for).
 * Extra keyword arguments become query string parameters; null/undefined values are dropped.
 */
function urlFor(endpoint, kwargs = {}) {
    const params = { ...kwargs };
    delete params.__keywords;

    let base;
    if (endpoint === 'static') {
        base = `/static/${params.filename}`;
        delete params.filename;
    } else {
        base = ENDPOINTS[endpoint];
        if (!base) throw new Error(`Could not build url for endpoint '${endpoint}'`);
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) query.append(key, String(value));
    }
    const queryString = query.toString();
    return queryString ? `${base}?${queryString}` : base;
}

function wantsJson(req) {
    return req.originalUrl.startsWith('/api/');
}

/** Application factory function */
async function createApp({ environment = config.environment, databaseConfig = null } = {}) {
    const app = express();
    app.disable('x-powered-by');

    // Templates (Nunjucks is Jinja2-compatible)
    const env = nunjucks.configure(path.join(__dirname, 'templates'), {
        autoescape: true,
        express: app,
        noCache: environment !== 'production'
    });
    env.addGlobal('url_for', urlFor);
    env.addFilter('format', printf);
    env.addFilter('strftime', strftime);
    app.set('view engine', 'html');

    // Initialize database
    await initDb(databaseConfig || config.getDatabaseConfig(environment));

    // Body parsing and static files
    app.use(express.json({ limit: '50mb' }));
    app.use('/static', express.static(path.join(__dirname, 'static')));

    // Register routes
    registerRoutes(app);

    // Handle 404 errors
    app.use((req, res) => {
        if (wantsJson(req)) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.status(404).render('error.html', { error_code: 404, error_message: 'Page not found' });
    });

    // Handle 500 errors
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
        }
        console.error(err);
        if (res.headersSent) return;
        if (wantsJson(req)) {
            return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
        }
        res.status(500).render('error.html', { error_code: 500, error_message: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp, urlFor };
