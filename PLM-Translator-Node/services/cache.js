/**
 * Simple in-memory cache with expiry (replacement for Flask-Caching's SimpleCache).
 * Used for background job progress tracking.
 */
'use strict';

const DEFAULT_TIMEOUT_SECONDS = 3600; // 1 hour

class SimpleCache {
    constructor({ defaultTimeout = DEFAULT_TIMEOUT_SECONDS } = {}) {
        this.defaultTimeout = defaultTimeout;
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value, timeoutSeconds = this.defaultTimeout) {
        this._prune();
        this.store.set(key, { value, expiresAt: Date.now() + timeoutSeconds * 1000 });
    }

    delete(key) {
        this.store.delete(key);
    }

    _prune() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (entry.expiresAt <= now) this.store.delete(key);
        }
    }
}

// Shared cache instance
const cache = new SimpleCache();

module.exports = { SimpleCache, cache };
