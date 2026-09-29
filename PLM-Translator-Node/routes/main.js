/**
 * Main routes for DN Translator application.
 * Handles page rendering and general web routes.
 */
'use strict';

const express = require('express');
const models = require('../models');
const { translatorService } = require('../services/translator');

const router = express.Router();

/** Parse an integer query parameter (Flask's request.args.get(name, default, type=int)) */
function intParam(value, fallback) {
    if (value === undefined || !/^[+-]?\d+$/.test(String(value).trim())) {
        return fallback;
    }
    return parseInt(value, 10);
}

/**
 * Page numbers for the pagination bar, with null for gaps
 * (same algorithm as Flask-SQLAlchemy's Pagination.iter_pages).
 */
function iterPages(page, pages, { leftEdge = 2, leftCurrent = 2, rightCurrent = 4, rightEdge = 2 } = {}) {
    const result = [];
    const range = (start, end) => { for (let i = start; i < end; i++) result.push(i); };
    const pagesEnd = pages + 1;

    if (pagesEnd === 1) return result;

    const leftEnd = Math.min(1 + leftEdge, pagesEnd);
    range(1, leftEnd);
    if (leftEnd === pagesEnd) return result;

    const midStart = Math.max(leftEnd, page - leftCurrent);
    const midEnd = Math.min(page + rightCurrent + 1, pagesEnd);
    if (midStart - leftEnd > 0) result.push(null);
    range(midStart, midEnd);
    if (midEnd === pagesEnd) return result;

    const rightStart = Math.max(midEnd, pagesEnd - rightEdge);
    if (rightStart - midEnd > 0) result.push(null);
    range(rightStart, pagesEnd);
    return result;
}

const SORT_OPTIONS = {
    id_asc: [{ column: 'id', order: 'asc' }],
    created_at_desc: [{ column: 'created_at', order: 'desc' }],
    created_at_asc: [{ column: 'created_at', order: 'asc' }],
    accuracy_desc: [{ column: 'accuracy', order: 'desc' }],
    accuracy_asc: [{ column: 'accuracy', order: 'asc' }],
    id_desc: [{ column: 'id', order: 'desc' }]
};

/** Main translator page */
router.get('/', async (req, res) => {
    const languages = await translatorService.getSupportedLanguages();
    res.render('translator.html', { languages });
});

/** Mass translation page with Excel upload */
router.get('/mass-translation', async (req, res) => {
    const languages = await translatorService.getSupportedLanguages();
    res.render('mass_translation.html', { languages });
});

/** View test results with pagination and server-side filtering/sorting for performance */
router.get('/test-results', async (req, res) => {
    try {
        const db = models.getDb();
        const table = models.TABLE;

        // Get pagination parameters
        let page = intParam(req.query.page, 1);
        let perPage = intParam(req.query.per_page, 50); // Default 50 records per page
        if (page < 1) page = 1;
        if (perPage < 1) perPage = 50;
        perPage = Math.min(perPage, 200); // Max 200 records per page

        // Get filter parameters
        const outcomeFilter = String(req.query.outcome || '').trim();
        const languageFilter = String(req.query.language || '').trim();
        const searchQuery = String(req.query.q || '').trim();

        // Get sort parameters
        const sortBy = String(req.query.sort || 'id_desc').trim();

        // Build filtered query
        const filtered = () => {
            const query = db(table);
            if (outcomeFilter) {
                if (outcomeFilter.toLowerCase() === 'failed') {
                    // Handle both 'Failed' and 'Failure' for comprehensive failed filter
                    query.whereIn('outcome', ['Failed', 'Failure']);
                } else {
                    query.where('outcome', outcomeFilter);
                }
            }
            if (languageFilter) {
                // Search in target_language field (stored as 'code-Name')
                models.whereILike(query, 'target_language', `%${languageFilter}%`);
            }
            if (searchQuery) {
                // Search across multiple text fields
                const searchTerm = `%${searchQuery}%`;
                query.where((qb) => {
                    models.whereILike(qb, 'tested_by', searchTerm, 'orWhereRaw');
                    models.whereILike(qb, 'observation', searchTerm, 'orWhereRaw');
                    models.whereILike(qb, 'text_to_translate', searchTerm, 'orWhereRaw');
                    models.whereILike(qb, 'translated_text', searchTerm, 'orWhereRaw');
                });
            }
            return query;
        };
        const count = async (query) => {
            const [{ count: value }] = await query.count('* as count');
            return Number(value);
        };

        // Get total count for all records (unfiltered) and filtered count
        const totalResults = await count(db(table));
        const filteredCount = await count(filtered());

        // Calculate maximum pages based on filtered results
        const maxPages = filteredCount > 0 ? Math.ceil(filteredCount / perPage) : 1;
        if (page > maxPages) {
            page = maxPages > 0 ? maxPages : 1;
        }

        // Calculate statistics
        let stats;
        if (outcomeFilter || languageFilter || searchQuery) {
            // Calculate stats for filtered data
            stats = {
                total: filteredCount,
                success: await count(filtered().where('outcome', 'Success')),
                partial: await count(filtered().where('outcome', 'Partial')),
                failed: await count(filtered().whereIn('outcome', ['Failed', 'Failure']))
            };
        } else {
            // Calculate statistics for all records (not just current page)
            stats = {
                total: totalResults,
                success: await count(db(table).where('outcome', 'Success')),
                partial: await count(db(table).where('outcome', 'Partial'))
            };

            // Count both 'Failure' (standard) and 'Failed' (legacy) for compatibility
            let failedCount = await count(db(table).whereIn('outcome', ['Failed', 'Failure']));

            // If we don't have explicit failed records, calculate as remainder
            if (failedCount === 0 && totalResults > 0) {
                failedCount = totalResults - stats.success - stats.partial;
            }
            stats.failed = failedCount;
        }

        // Calculate success rate
        stats.success_rate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;

        // Get paginated results
        const rows = await filtered()
            .orderBy(SORT_OPTIONS[sortBy] || SORT_OPTIONS.id_desc)
            .limit(perPage)
            .offset((page - 1) * perPage);
        const results = rows.map(models.toTestResult);

        const pages = Math.ceil(filteredCount / perPage);
        const pagination = {
            page,
            per_page: perPage,
            total: filteredCount, // Use filtered count for pagination
            pages,
            has_prev: page > 1,
            prev_num: page > 1 ? page - 1 : null,
            has_next: page < pages,
            next_num: page < pages ? page + 1 : null,
            iter_pages: iterPages(page, pages, { leftEdge: 1, rightEdge: 1, leftCurrent: 1, rightCurrent: 2 })
        };

        if (pagination.pages < 1) {
            pagination.pages = 1;
        }
        // Ensure iter_pages is never empty
        if (pagination.iter_pages.length === 0) {
            pagination.iter_pages = [pagination.page];
        }

        // Get unique languages for filter dropdown
        const languageRows = await db(table)
            .distinct('target_language')
            .whereNotNull('target_language')
            .orderBy('target_language');
        const uniqueLanguages = languageRows.map((row) => row.target_language).filter(Boolean);

        res.render('test_results.html', {
            results,
            pagination,
            stats,
            total_results: totalResults,
            filtered_count: filteredCount,
            unique_languages: uniqueLanguages,
            current_filters: {
                outcome: outcomeFilter,
                language: languageFilter,
                search: searchQuery,
                sort: sortBy
            }
        });
    } catch (e) {
        res.status(500).type('text/plain').send(`Error loading test results: ${e.message}`);
    }
});

module.exports = { router, iterPages };
