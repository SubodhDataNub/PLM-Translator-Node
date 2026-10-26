sap.ui.define([
    "./BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/BusyDialog",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/api",
    "../model/text"
], function (BaseController, JSONModel, Filter, FilterOperator, BusyDialog, MessageToast, MessageBox, api, text) {
    "use strict";

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const AUTO_VALIDATE_SIZE = 5 * 1024 * 1024;
    const LARGE_FILE_ROWS = 10000;
    const COMMON_LANGUAGES = ["ar", "zh-CN", "da", "nl", "fr", "id", "it", "ja", "pt", "es", "tr"];
    const LABEL_TYPE_NAMES = { food: "food", cosmetic: "cosmetic or detergent", general: "general" };

    return BaseController.extend("dn.translator.controller.MassTranslation", {
        onInit() {
            this.getView().setModel(new JSONModel({
                hasFile: false,
                fileSize: "",
                validating: false,
                validation: null,
                estimate: null,
                recommendations: [],
                largeFile: false,
                largeFileText: "",
                selectedText: this.text("selectedCount", [0]),
                selectedState: "None",
                testedBy: "",
                testedByState: "None",
                running: false,
                result: null
            }), "view");

            const languageModel = new JSONModel([]);
            languageModel.setSizeLimit(1000);
            this.getView().setModel(languageModel, "lang");
            this.languagesLoaded().then((languages) => {
                languageModel.setData(languages.map((lang) => ({ code: lang.code, name: lang.name, selected: false })));
            });

            this._file = null;
            this._validation = null;

            this.byId("filePanel").addEventDelegate({ onAfterRendering: () => this._attachDropZone() });

            this._onBeforeUnload = (event) => {
                if (this.getViewModel().getProperty("/running")) {
                    event.preventDefault();
                    event.returnValue = this.text("massRunning");
                }
            };
            window.addEventListener("beforeunload", this._onBeforeUnload);
        },

        onExit() {
            window.removeEventListener("beforeunload", this._onBeforeUnload);
            clearTimeout(this._estimateTimer);
            clearTimeout(this._validateTimer);
        },

        onFileChange(event) {
            const files = event.getParameter("files");
            if (files && files.length) {
                this._selectFile(files[0]);
            }
        },

        onTypeMismatch() {
            MessageBox.warning(this.text("excelOnly"));
        },

        _attachDropZone() {
            const dom = this.byId("filePanel").getDomRef();
            if (!dom || dom.dataset.dnDropZone) return;
            dom.dataset.dnDropZone = "true";

            dom.addEventListener("dragover", (event) => {
                event.preventDefault();
                dom.classList.add("dnDragOver");
            });
            dom.addEventListener("dragleave", (event) => {
                if (!dom.contains(event.relatedTarget)) dom.classList.remove("dnDragOver");
            });
            dom.addEventListener("drop", (event) => {
                event.preventDefault();
                dom.classList.remove("dnDragOver");
                const files = event.dataTransfer && event.dataTransfer.files;
                if (files && files.length && !this.getViewModel().getProperty("/running")) {
                    this._selectFile(files[0]);
                }
            });
        },

        _selectFile(file) {
            const name = file.name.toLowerCase();
            if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
                MessageBox.warning(this.text("excelOnly"));
                return;
            }
            if (file.size > MAX_FILE_SIZE) {
                MessageBox.warning(this.text("fileTooLarge", [text.formatFileSize(MAX_FILE_SIZE)]));
                return;
            }

            this._file = file;
            this._validation = null;
            this.byId("fileUploader").setValue(file.name);

            const model = this.getViewModel();
            model.setProperty("/hasFile", true);
            model.setProperty("/fileSize", text.formatFileSize(file.size));
            model.setProperty("/validation", null);
            model.setProperty("/estimate", null);
            model.setProperty("/recommendations", []);
            model.setProperty("/largeFile", false);

            if (file.size > AUTO_VALIDATE_SIZE) {
                clearTimeout(this._validateTimer);
                this._validateTimer = setTimeout(() => this.onValidate(), 500);
            }
        },

        async onValidate() {
            if (!this._file) {
                MessageToast.show(this.text("selectFileFirst"));
                return;
            }
            const model = this.getViewModel();
            model.setProperty("/validating", true);
            try {
                const result = await api.validateFile(this._file);
                this._validation = result;
                const base = result.timeEstimates;

                model.setProperty("/validation", {
                    fileSize: `${result.fileSizeMb} MB`,
                    totalRows: Number(result.totalRows || 0).toLocaleString(),
                    textColumn: result.textColumn || "–",
                    columns: (result.columns || []).join(", "),
                    baseEstimate: base ? this.text("minutes", [Math.round(base.estimatedMinutes)]) : "–",
                    recordCount: base ? Number(base.recordCount || 0).toLocaleString() : "–"
                });
                model.setProperty("/recommendations", result.recommendations || []);

                const isLarge = result.totalRows > LARGE_FILE_ROWS;
                model.setProperty("/largeFile", isLarge);
                model.setProperty("/largeFileText", isLarge
                    ? this.text("largeFileWarning", [
                        Number(result.totalRows).toLocaleString(),
                        Math.round((base && base.estimatedMinutes) || 10)
                    ])
                    : "");

                this._updateEstimate();
            } catch (error) {
                MessageBox.error(this.text("validationFailed", [this.errorMessage(error)]));
            } finally {
                model.setProperty("/validating", false);
            }
        },

        onLanguageSearch(event) {
            const query = (event.getParameter("newValue") ?? event.getParameter("query") ?? "").trim();
            const filters = query
                ? [new Filter({
                    filters: [
                        new Filter("name", FilterOperator.Contains, query),
                        new Filter("code", FilterOperator.Contains, query)
                    ],
                    and: false
                })]
                : [];
            this.byId("languageTable").getBinding("items").filter(filters);
        },

        onLanguageSelectionChange() {
            this._onSelectionChanged();
        },

        onSelectCommon() {
            const languages = this.getView().getModel("lang").getData();
            const hasZhCn = languages.some((lang) => lang.code === "zh-CN");
            const codes = COMMON_LANGUAGES.map((code) => (code === "zh-CN" && !hasZhCn ? "zh" : code));
            this._setSelection((lang) => codes.includes(lang.code));
        },

        onClearLanguages() {
            this._setSelection(() => false);
        },

        _setSelection(isSelected) {
            const model = this.getView().getModel("lang");
            model.getData().forEach((lang) => { lang.selected = isSelected(lang); });
            model.refresh(true);
            this._onSelectionChanged();
        },

        _selectedCodes() {
            return this.getView().getModel("lang").getData()
                .filter((lang) => lang.selected)
                .map((lang) => lang.code);
        },

        _onSelectionChanged() {
            const count = this._selectedCodes().length;
            const model = this.getViewModel();
            model.setProperty("/selectedText", this.text("selectedCount", [count]));
            model.setProperty("/selectedState",
                count === 0 ? "None" : count <= 5 ? "Success" : count <= 15 ? "Information" : "Warning");

            clearTimeout(this._estimateTimer);
            this._estimateTimer = setTimeout(() => this._updateEstimate(), 300);
        },

        async _updateEstimate() {
            const model = this.getViewModel();
            const rows = this._validation && this._validation.totalRows;
            if (!rows) return;

            const codes = this._selectedCodes();
            if (!codes.length) {
                model.setProperty("/estimate", null);
                return;
            }
            try {
                const estimate = await api.estimateProcessingTime(rows, codes);
                if (this._selectedCodes().join() !== codes.join()) return;
                model.setProperty("/estimate", {
                    time: text.formatDuration(estimate.estimatedMinutes, estimate.estimatedHours),
                    languages: String(estimate.languageCount),
                    total: (rows * codes.length).toLocaleString(),
                    recommendation: estimate.recommendation || ""
                });
            } catch (error) {
            }
        },

        onTestedByChange() {
            this.getViewModel().setProperty("/testedByState", "None");
        },

        async onStart() {
            const model = this.getViewModel();
            const codes = this._selectedCodes();
            const testedBy = model.getProperty("/testedBy").trim();

            if (!this._file) {
                MessageBox.warning(this.text("selectFile"));
                return;
            }
            if (!codes.length) {
                MessageBox.warning(this.text("selectOneLanguage"));
                return;
            }
            if (!testedBy) {
                model.setProperty("/testedByState", "Error");
                this.byId("massTestedBy").focus();
                return;
            }

            const busyDialog = this._getBusyDialog();
            model.setProperty("/running", true);
            model.setProperty("/result", null);
            busyDialog.open();

            try {
                const data = await api.massTranslate(this._file, codes, testedBy);
                const labelTypes = Object.entries(data.labelTypes || {})
                    .filter(([, count]) => count > 0)
                    .map(([type, count]) => `${count} ${LABEL_TYPE_NAMES[type] || type}`);

                this._sessionId = data.sessionId || null;
                model.setProperty("/result", {
                    totalRows: String(data.totalRows),
                    successful: String(data.successful),
                    failed: String(data.failed),
                    failedCount: data.failed,
                    successRate: String(data.successRate),
                    message: this.text("massDone", [data.totalRows]),
                    labelTypes: labelTypes.length ? this.text("labelTypesPerRow", [labelTypes.join(", ")]) : ""
                });
                this._scrollToResults();
            } catch (error) {
                MessageBox.error(this.text("massFailed", [this.errorMessage(error)]));
            } finally {
                model.setProperty("/running", false);
                busyDialog.close();
            }
        },

        _getBusyDialog() {
            if (!this._busyDialog) {
                this._busyDialog = new BusyDialog({
                    title: this.text("processingTitle"),
                    text: this.text("processingText")
                });
                this.getView().addDependent(this._busyDialog);
            }
            return this._busyDialog;
        },

        _scrollToResults() {
            setTimeout(() => {
                const page = this.byId("page");
                const panel = this.byId("resultsPanel");
                const scroller = page.getScrollDelegate && page.getScrollDelegate();
                if (scroller && panel.getDomRef()) scroller.scrollToElement(panel.getDomRef(), 300);
            }, 0);
        },

        async onDownloadResults() {
            if (!this._sessionId) {
                MessageToast.show(this.text("noSession"));
                return;
            }
            try {
                await api.downloadSessionResults(this._sessionId);
            } catch (error) {
                MessageBox.error(this.text("downloadFailed", [this.errorMessage(error)]));
            }
        },

        async onDownloadTemplate() {
            try {
                await api.downloadTemplate();
            } catch (error) {
                MessageBox.error(this.text("templateFailed", [this.errorMessage(error)]));
            }
        },

        onOpenResults() {
            this.getRouter().navTo("testResults");
        }
    });
});
