/**
 * Theme choice: system (follows the OS), light (Horizon) or dark (Horizon Dark).
 * The choice is saved in localStorage; index.html applies it before UI5 starts.
 */
sap.ui.define([
    "sap/ui/core/Theming"
], function (Theming) {
    "use strict";

    const STORAGE_KEY = "dn-theme";
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function readChoice() {
        try {
            const value = localStorage.getItem(STORAGE_KEY);
            return value === "light" || value === "dark" ? value : "system";
        } catch (e) {
            return "system";
        }
    }

    let choice = readChoice();

    function apply() {
        const dark = choice === "dark" || (choice === "system" && darkQuery.matches);
        document.documentElement.classList.toggle("dnDark", dark);
        Theming.setTheme(dark ? "sap_horizon_dark" : "sap_horizon");
    }

    return {
        init() {
            darkQuery.addEventListener("change", () => {
                if (choice === "system") apply();
            });
        },

        getChoice() {
            return choice;
        },

        setChoice(value) {
            choice = value === "light" || value === "dark" ? value : "system";
            try {
                if (choice === "system") {
                    localStorage.removeItem(STORAGE_KEY);
                } else {
                    localStorage.setItem(STORAGE_KEY, choice);
                }
            } catch (e) {
                // Storage blocked: the choice still applies to this page view
            }
            apply();
        }
    };
});
