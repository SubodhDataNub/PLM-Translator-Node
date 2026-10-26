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

        text(key, args) {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
        },

        languagesLoaded() {
            return this.getOwnerComponent().languagesLoaded;
        },

        getLanguages() {
            return this.getOwnerComponent().getModel("languages").getData() || [];
        },

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

        errorMessage(error) {
            const message = (error && error.message) || String(error);
            return /fetch/i.test(message) ? this.text("networkError") : message;
        }
    });
});
