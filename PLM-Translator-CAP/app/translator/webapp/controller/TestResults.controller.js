sap.ui.define([
    "./BaseController",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "../model/api",
    "../model/formatter"
], function (BaseController, Fragment, JSONModel, MessageBox, api, formatter) {
    "use strict";

    const DEFAULT_SORT = "id_desc";
    const PAGE_SIZE = 50;

    return BaseController.extend("dn.translator.controller.TestResults", {
        formatter,

        onInit() {
            this.getView().setModel(new JSONModel({
                search: "",
                outcome: "",
                language: "",
                sort: DEFAULT_SORT,
                languages: [{ key: "", text: this.text("allLanguages") }],
                stats: { total: "–", success: "–", partial: "–", failed: "–", successRate: "–" },
                statsSummary: "",
                totalLabel: this.text("kpiRecords"),
                tableTitle: this.text("tableRecords"),
                filtered: false,
                exporting: false
            }), "view");

            this._template = this.byId("rowTemplate");
            this.byId("resultsTable").setGrowingThreshold(PAGE_SIZE);

            this.getRouter().getRoute("testResults").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched(event) {
            const query = event.getParameter("arguments")["?query"] || {};
            const model = this.getViewModel();
            const language = String(query.language || "").trim();
            this._setLanguageOptions(model.getProperty("/languages").slice(1).map((item) => item.key), language);
            model.setProperty("/search", String(query.q || "").trim());
            model.setProperty("/outcome", String(query.outcome || "").trim());
            model.setProperty("/language", language);
            model.setProperty("/sort", api.SORT_ORDERS[query.sort] ? query.sort : DEFAULT_SORT);

            this._loadLanguages();
            this._load();
        },

        onSearch() {
            this._navigate();
        },

        onFilterChange() {
            this._navigate();
        },

        onClearFilters() {
            const model = this.getViewModel();
            model.setProperty("/search", "");
            model.setProperty("/outcome", "");
            model.setProperty("/language", "");
            model.setProperty("/sort", DEFAULT_SORT);
            this._navigate();
        },

        onRefresh() {
            this._loadLanguages();
            this._load();
        },

        _navigate() {
            const { search, outcome, language, sort } = this.getViewModel().getData();
            const query = {};
            if (search.trim()) query.q = search.trim();
            if (outcome) query.outcome = outcome;
            if (language) query.language = language;
            if (sort !== DEFAULT_SORT) query.sort = sort;
            this.getRouter().navTo("testResults", Object.keys(query).length ? { "?query": query } : {}, true);
        },

        _filters() {
            const { search, outcome, language } = this.getViewModel().getData();
            return { outcome, language, search: search.trim() };
        },

        _load() {
            const model = this.getViewModel();
            const filters = this._filters();
            const filtered = Boolean(filters.outcome || filters.language || filters.search);
            model.setProperty("/filtered", filtered);
            model.setProperty("/totalLabel", this.text(filtered ? "kpiMatching" : "kpiRecords"));

            const parameters = { $count: true, $orderby: api.SORT_ORDERS[model.getProperty("/sort")] };
            const $filter = api.resultFilter(filters);
            if ($filter) parameters.$filter = $filter;

            const table = this.byId("resultsTable");
            table.bindItems({
                path: "/TestResults",
                parameters,
                template: this._template,
                templateShareable: true,
                events: {
                    change: () => this._updateCount(),
                    dataReceived: (event) => {
                        const error = event.getParameter("error");
                        if (error) MessageBox.error(this.text("loadFailed", [this.errorMessage(error)]));
                    }
                }
            });

            api.statistics(filters)
                .then((stats) => {
                    const rate = `${Number(stats.successRate || 0).toFixed(1)}`;
                    model.setProperty("/stats", {
                        total: String(stats.total),
                        success: String(stats.success),
                        partial: String(stats.partial),
                        failed: String(stats.failed),
                        successRate: rate
                    });
                    model.setProperty("/statsSummary", this.text("statsSummary", [
                        stats.total, stats.success, stats.partial, stats.failed, rate
                    ]));
                })
                .catch((error) => {
                    model.setProperty("/stats", { total: "–", success: "–", partial: "–", failed: "–", successRate: "–" });
                    MessageBox.error(this.text("statsFailed", [this.errorMessage(error)]));
                });
        },

        _updateCount() {
            const binding = this.byId("resultsTable").getBinding("items");
            if (!binding) return;
            const label = this.text(this.getViewModel().getProperty("/filtered") ? "tableMatching" : "tableRecords");
            binding.getHeaderContext().requestProperty("$count").then((count) => {
                this.getViewModel().setProperty("/tableTitle",
                    count === undefined ? label : `${label} (${Number(count).toLocaleString()})`);
            });
        },

        async _loadLanguages() {
            try {
                this._setLanguageOptions(await api.resultLanguages(), this.getViewModel().getProperty("/language"));
            } catch (error) {
            }
        },

        _setLanguageOptions(languages, current) {
            const list = languages.slice();
            if (current && !list.includes(current)) list.unshift(current);
            this.getViewModel().setProperty("/languages", [
                { key: "", text: this.text("allLanguages") },
                ...list.map((lang) => ({ key: lang, text: lang }))
            ]);
        },

        async onExport() {
            const model = this.getViewModel();
            model.setProperty("/exporting", true);
            try {
                await api.exportTestResults(this._filters());
            } catch (error) {
                MessageBox.error(this.text("exportFailed", [this.errorMessage(error)]));
            } finally {
                model.setProperty("/exporting", false);
            }
        },

        async onRowPress(event) {
            const context = event.getSource().getBindingContext();
            if (!this._detailsDialog) {
                this._detailsDialog = await Fragment.load({
                    id: this.getView().getId(),
                    name: "dn.translator.view.ResultDetails",
                    controller: this
                });
                this.getView().addDependent(this._detailsDialog);
            }
            this._detailsDialog.setBindingContext(context);
            this._detailsDialog.open();
        },

        onCloseDetails() {
            this._detailsDialog.close();
        },

        onGoTranslate() {
            this.getRouter().navTo("translate");
        },

        onGoMass() {
            this.getRouter().navTo("massTranslation");
        }
    });
});
