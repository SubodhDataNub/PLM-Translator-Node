/**
 * Routes package for DN Translator application.
 * Registers the page routes and the API routes.
 */
'use strict';

const { router: mainRouter } = require('./main');
const { router: apiRouter } = require('./api');

/** Register all routers with the Express app */
function registerRoutes(app) {
    app.use('/', mainRouter);
    app.use('/api', apiRouter);
}

module.exports = { registerRoutes };
