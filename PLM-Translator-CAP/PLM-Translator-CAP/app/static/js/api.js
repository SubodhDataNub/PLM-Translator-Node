/**
 * DN Translator - client for the CAP OData V4 service (srv/translator-service.cds).
 * The pages call these helpers instead of the Node.js version's /api/* endpoints.
 */
window.DNApi = (function () {
    'use strict';

    const BASE = '/odata/v4/translator';

    const SORT_ORDERS = {
        id_desc: 'ID desc',
        id_asc: 'ID asc',
        created_at_desc: 'createdAt desc,ID desc',
        created_at_asc: 'createdAt asc,ID asc',
        accuracy_desc: 'accuracy desc,ID desc',
        accuracy_asc: 'accuracy asc,ID asc'
    };

    /** Send a request and return the parsed JSON; OData errors become Error(message) */
    async function request(path, { method = 'GET', body } = {}) {
        const headers = { Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        const response = await fetch(BASE + path, {
            method,
            headers,
            cache: 'no-store',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status === 204) return null;

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            // Empty or non-JSON body
        }
        if (!response.ok) {
            const message = (data && data.error && data.error.message) || `${response.status} ${response.statusText}`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    /** OData string literal: quotes doubled */
    function literal(value) {
        return `'${String(value ?? '').replace(/'/g, "''")}'`;
    }

    /** URL for a function call with string parameters, e.g. resultStatistics(outcome='x',...) */
    function functionPath(name, params = {}) {
        const args = Object.entries(params)
            .map(([key, value]) => `${key}=${encodeURIComponent(literal(value))}`)
            .join(',');
        return `/${name}(${args})`;
    }

    function stripContext(data) {
        if (data && typeof data === 'object') delete data['@odata.context'];
        return data;
    }

    /** OData $filter for the test results filters (same semantics as the server-side statistics) */
    function resultFilter({ outcome, language, search } = {}) {
        const conditions = [];
        outcome = String(outcome || '').trim();
        language = String(language || '').trim().toLowerCase();
        search = String(search || '').trim().toLowerCase();

        if (outcome) {
            conditions.push(outcome.toLowerCase().includes('fail')
                ? "(outcome eq 'Failed' or outcome eq 'Failure')"
                : `outcome eq ${literal(outcome)}`);
        }
        if (language) {
            conditions.push(`contains(tolower(targetLanguage),${literal(language)})`);
        }
        if (search) {
            const fields = ['testedBy', 'observation', 'textToTranslate', 'translatedText'];
            conditions.push(`(${fields.map((f) => `contains(tolower(${f}),${literal(search)})`).join(' or ')})`);
        }
        return conditions.join(' and ');
    }

    /** Read a File as base64 (without the data: URL prefix) */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
            reader.readAsDataURL(file);
        });
    }

    /** Save an ExcelFile result ({fileName, mimeType, content: base64}) as a download */
    function saveFile(file, fallbackName) {
        const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: file.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.fileName || fallbackName || 'download.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
        resultFilter,
        fileToBase64,
        saveFile,

        /** Target languages as [{key, text}], with the placeholder entry first */
        async languages() {
            const data = await request('/languages()');
            const languages = (data.value || []).map((lang) => ({ key: lang.code, text: lang.name }));
            return [{ key: '', text: 'Select Target Language' }, ...languages];
        },

        async translate(text, targetLanguage, labelType) {
            const body = { text, targetLanguage };
            if (labelType) body.labelType = labelType;
            return stripContext(await request('/translate', { method: 'POST', body }));
        },

        async userInfo() {
            return stripContext(await request('/userInfo()'));
        },

        // --- Test results ------------------------------------------------------

        async saveTestResult(record) {
            return stripContext(await request('/TestResults', { method: 'POST', body: record }));
        },

        async getTestResult(id) {
            return stripContext(await request(`/TestResults(${encodeURIComponent(id)})`));
        },

        async deleteTestResult(id) {
            await request(`/TestResults(${encodeURIComponent(id)})`, { method: 'DELETE' });
        },

        /** One page of test results: {results, total} */
        async listTestResults({ page = 1, perPage = 50, sort = 'id_desc', ...filters } = {}) {
            // encodeURIComponent, not URLSearchParams: the OData parser does not read '+' as a space
            const params = {
                $filter: resultFilter(filters),
                $orderby: SORT_ORDERS[sort] || SORT_ORDERS.id_desc,
                $top: String(perPage),
                $skip: String((page - 1) * perPage),
                $count: 'true'
            };
            const query = Object.entries(params)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
                .join('&');
            const data = await request(`/TestResults?${query}`);
            return { results: data.value || [], total: data['@odata.count'] || 0 };
        },

        async statistics(filters = {}) {
            return stripContext(await request(functionPath('resultStatistics', {
                outcome: filters.outcome, language: filters.language, search: filters.search
            })));
        },

        async resultLanguages() {
            const data = await request('/resultLanguages()');
            return data.value || [];
        },

        async exportTestResults(filters = {}) {
            saveFile(await request(functionPath('exportTestResults', {
                outcome: filters.outcome, language: filters.language, search: filters.search
            })), 'test_results.xlsx');
        },

        // --- Mass translation --------------------------------------------------

        async validateFile(file, targetLanguages = []) {
            const content = await fileToBase64(file);
            return stripContext(await request('/validateFile', {
                method: 'POST',
                body: { fileName: file.name, content, targetLanguages }
            }));
        },

        async estimateProcessingTime(recordCount, targetLanguages) {
            return stripContext(await request('/estimateProcessingTime', {
                method: 'POST',
                body: { recordCount, targetLanguages }
            }));
        },

        async massTranslate(file, targetLanguages, testedBy, labelType) {
            const content = await fileToBase64(file);
            const body = { fileName: file.name, content, targetLanguages, testedBy };
            if (labelType) body.labelType = labelType;
            return stripContext(await request('/massTranslate', { method: 'POST', body }));
        },

        async downloadSessionResults(sessionId) {
            saveFile(await request(functionPath('downloadSessionResults', { sessionId })), 'translation_results.xlsx');
        },

        async downloadTemplate() {
            saveFile(await request('/downloadTemplate()'), 'mass_translation_template.xlsx');
        }
    };
})();
