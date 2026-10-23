/**
 * DN Translator - shared page chrome: the theme toggle (system / light / dark) and the footer slug date.
 * The saved theme is applied before first paint by the inline script in templates/partials/head.html.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'dn-theme';
    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function readChoice() {
        try {
            const value = localStorage.getItem(STORAGE_KEY);
            return value === 'light' || value === 'dark' ? value : 'system';
        } catch (e) {
            return 'system';
        }
    }

    function saveChoice(choice) {
        try {
            if (choice === 'system') {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, choice);
            }
        } catch (e) {
            // Storage blocked: the choice still applies to this page view
        }
    }

    let currentChoice = readChoice();

    function applyTheme(choice) {
        currentChoice = choice;
        if (choice === 'system') {
            delete root.dataset.theme;
        } else {
            root.dataset.theme = choice;
        }
        // Bootstrap components (modal close button, menus) follow data-bs-theme
        const dark = choice === 'dark' || (choice === 'system' && darkQuery.matches);
        root.dataset.bsTheme = dark ? 'dark' : 'light';

        document.querySelectorAll('[data-theme-choice]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
        });
    }

    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
        button.addEventListener('click', () => {
            saveChoice(button.dataset.themeChoice);
            applyTheme(button.dataset.themeChoice);
        });
    });

    darkQuery.addEventListener('change', () => {
        if (currentChoice === 'system') applyTheme('system');
    });

    applyTheme(currentChoice);

    // Footer slug: today's local date as YYYY-MM-DD
    const slugDate = document.getElementById('slugDate');
    if (slugDate) {
        const now = new Date();
        const iso = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('-');
        slugDate.textContent = iso;
        slugDate.dateTime = iso;
    }
})();
