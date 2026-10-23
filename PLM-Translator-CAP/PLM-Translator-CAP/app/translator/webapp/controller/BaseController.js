sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent"
], function (Controller, UIComponent) {
    "use strict";

    return Controller.extend("dn.translator.controller.BaseController", {
        getRouter() {
            return UIComponent.getRouterFor(this);
        },

        getViewModel() {
            return this.getView().getModel("view");
        },

        /** Text from i18n.properties, with {0}, {1}... replaced by args */
        text(key, args) {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
        },

        /** Target languages [{code, name}] once they are loaded */
        languagesLoaded() {
            return this.getOwnerComponent().languagesLoaded;
        },

        getLanguages() {
            return this.getOwnerComponent().getModel("languages").getData() || [];
        },

        /**
         * Language name for a code: from the target language list (also matching the base code, zh-CN -> zh),
         * else the browser's name for it (source languages such as English are not target languages), else the code
         */
        getLanguageName(code) {
            if (!code || code === "auto") return this.text("detectedFallback");
            const languages = this.getLanguages();
            const base = String(code).split("-")[0];
            const language = languages.find((lang) => lang.code === code) ||
                languages.find((lang) => lang.code && lang.code.split("-")[0] === base);
            if (language && language.name) return language.name;
            try {
                return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
            } catch (error) {
                return code;
            }
        },

        /** Error text for a failed request; "Failed to fetch" means the server could not be reached */
        errorMessage(error) {
            const message = (error && error.message) || String(error);
            return /fetch/i.test(message) ? this.text("networkError") : message;
        }
    });
});
