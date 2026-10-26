sap.ui.define([
    "./BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../model/api",
    "../model/text"
], function (BaseController, JSONModel, MessageToast, MessageBox, api, text) {
    "use strict";

    const MAX_CHARS = 5000;
    const HISTORY_SIZE = 12;
    const OUTCOMES = ["Success", "Partial", "Failure"];
    const FAILURE_INDEX = 2;
    const COMMON_LANGUAGES = ["es", "fr", "de", "it", "zh-CN"];
    const MAX_RECENT = 4;
    const RECENT_STORAGE_KEY = "dn-recent-languages";

    function readRecent() {
        try {
            const value = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
            return Array.isArray(value) ? value.filter((code) => typeof code === "string") : [];
        } catch (e) {
            return [];
        }
    }

    function saveRecent(codes) {
        try {
            localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(codes));
        } catch (e) {
        }
    }
    const LABEL_TYPES = { general: "labelTypeGeneral", food: "labelTypeFood", cosmetic: "labelTypeCosmetic" };

    function emptyReview(testedBy) {
        return {
            outcomeIndex: -1,
            outcomeState: "None",
            accuracy: "",
            accuracyState: "None",
            accuracyStateText: "",
            accuracyPercent: 0,
            accuracyRequired: true,
            accuracyLabel: "",
            testedBy: testedBy || "",
            testedByState: "None",
            observation: "",
            saving: false,
            canSave: false,
            saveHint: ""
        };
    }

    return BaseController.extend("dn.translator.controller.Translate", {
        onInit() {
            const model = new JSONModel({
                sourceText: "",
                translatedText: "",
                targetLanguage: "",
                busy: false,
                detected: "",
                detectedText: "",
                terminologyNote: "",
                meta: "",
                copyIcon: "sap-icon://copy",
                canTranslate: false,
                translateHint: "",
                chips: [],
                sessionTranslations: 0,
                sessionTests: 0,
                sessionText: "",
                tab: "review",
                review: emptyReview(),
                history: [],
                historyCount: 0
            });
            this.getView().setModel(model, "view");

            this._last = null;

            this._recentLocal = readRecent();
            this._recentSaved = [];
            api.recentSingleLanguages()
                .then((stored) => {
                    this._recentSaved = stored;
                    this._update();
                })
                .catch(() => { });
            this.languagesLoaded().then(() => this._update());

            model.attachPropertyChange((event) => {
                const context = event.getParameter("context");
                const path = event.getParameter("path");
                this._onPropertyChange(context ? `${context.getPath()}/${path}` : path);
            });

            this.byId("languageCombo").setFilterFunction((term, item) => {
                const needle = String(term || "").toLowerCase();
                return item.getText().toLowerCase().includes(needle) || item.getKey().toLowerCase().includes(needle);
            });

            this._addDomAttributes("sourceText", () => ({ dir: "auto" }));
            this._addDomAttributes("translatedText", () => ({ dir: "auto", lang: this._translatedLang || null }));

            this._chipRowObserver = new ResizeObserver(() => this._alignChipRows());
            this.byId("targetChipRow").addEventDelegate({
                onAfterRendering: () => {
                    this._chipRowObserver.disconnect();
                    const dom = this.byId("targetChipRow").getDomRef();
                    if (dom) this._chipRowObserver.observe(dom);
                }
            });

            this._onKeyDown = this._handleKeyDown.bind(this);
            document.addEventListener("keydown", this._onKeyDown);

            this._onBeforeUnload = (event) => {
                if (this._hasUnsavedReview()) {
                    event.preventDefault();
                    event.returnValue = this.text("unsavedReview");
                }
            };
            window.addEventListener("beforeunload", this._onBeforeUnload);

            this._active = true;
            this.getRouter().attachRouteMatched((event) => {
                this._active = event.getParameter("name") === "translate";
            });

            this._update();
        },

        onExit() {
            document.removeEventListener("keydown", this._onKeyDown);
            window.removeEventListener("beforeunload", this._onBeforeUnload);
            clearTimeout(this._copyTimer);
            this._chipRowObserver.disconnect();
        },

        async onTranslate() {
            const model = this.getViewModel();
            const sourceText = model.getProperty("/sourceText").trim();
            const targetLanguage = model.getProperty("/targetLanguage");

            if (!sourceText) {
                MessageToast.show(this.text("enterText"));
                this.byId("sourceText").focus();
                return;
            }
            if (!targetLanguage) {
                MessageToast.show(this.text("selectLanguage"));
                this.byId("languageCombo").focus();
                return;
            }
            if (sourceText.length > MAX_CHARS) {
                MessageBox.error(this.text("textTooLong", [MAX_CHARS]));
                return;
            }

            model.setProperty("/busy", true);
            model.setProperty("/terminologyNote", "");
            this._update();
            const startedAt = performance.now();

            try {
                const result = await api.translate(sourceText, targetLanguage);
                const elapsedMs = performance.now() - startedAt;
                const targetName = this.getLanguageName(targetLanguage);

                this._last = {
                    sourceText,
                    translatedText: result.translatedText,
                    sourceLanguage: this._displayName(result.sourceLanguage),
                    targetLanguage: this._displayName(targetLanguage)
                };

                this._showResult({
                    translatedText: result.translatedText,
                    sourceCode: result.sourceLanguage,
                    targetCode: targetLanguage,
                    terminology: result.terminology,
                    labelType: result.labelType
                });
                model.setProperty("/meta", this.text("resultMeta", [
                    Math.round(elapsedMs).toLocaleString(),
                    text.countWords(result.translatedText, targetLanguage).toLocaleString(),
                    text.countCharacters(result.translatedText).toLocaleString()
                ]));
                model.setProperty("/sessionTranslations", model.getProperty("/sessionTranslations") + 1);
                this._rememberLanguage(targetLanguage);

                this._addToHistory({
                    sourceText,
                    translatedText: result.translatedText,
                    sourceCode: result.sourceLanguage,
                    targetCode: targetLanguage,
                    route: `${this.getLanguageName(result.sourceLanguage)} → ${targetName}`,
                    terminology: result.terminology,
                    labelType: result.labelType,
                    result: { ...this._last }
                });

                MessageToast.show(this.text("translateDone", [targetName]));
            } catch (error) {
                MessageBox.error(this.text("translateFailed", [this.errorMessage(error)]));
                model.setProperty("/translatedText", "");
                model.setProperty("/meta", "");
                this._setTranslatedLang(null);
            } finally {
                model.setProperty("/busy", false);
                this._update();
            }
        },

        _showResult({ translatedText, sourceCode, targetCode, terminology, labelType }) {
            const model = this.getViewModel();
            model.setProperty("/translatedText", translatedText);
            model.setProperty("/detected", sourceCode || "");
            model.setProperty("/terminologyNote", this._terminologyNote(terminology, labelType));
            model.setProperty("/tab", "review");
            this._setTranslatedLang(targetCode);
        },

        onChipPress(event) {
            const chip = event.getSource().getBindingContext("view").getObject();
            this.getViewModel().setProperty("/targetLanguage", chip.code);
            event.getSource().setPressed(true);
            this._update();
        },

        _rememberLanguage(code) {
            this._recentLocal = [code, ...this._recentLocal.filter((item) => item !== code)].slice(0, 10);
            saveRecent(this._recentLocal);
        },

        _resolveLanguage(value) {
            const languages = this.getLanguages();
            if (!value || !languages.length) return null;
            const exact = languages.find((lang) => lang.code === value);
            if (exact) return exact.code;
            const stored = languages
                .filter((lang) => value.startsWith(`${lang.code}-`))
                .sort((a, b) => b.code.length - a.code.length)[0];
            if (stored) return stored.code;
            const base = languages.find((lang) => lang.code === value.split("-")[0]);
            return base ? base.code : null;
        },

        _alignChipRows() {
            const source = this.byId("sourceChipRow").getDomRef();
            const target = this.byId("targetChipRow").getDomRef();
            if (!source || !target) return;
            source.style.minHeight = "";
            const sideBySide = Math.abs(source.getBoundingClientRect().top - target.getBoundingClientRect().top) < 2;
            if (sideBySide) source.style.minHeight = `${target.getBoundingClientRect().height}px`;
        },

        _updateChips() {
            const model = this.getViewModel();
            const target = model.getProperty("/targetLanguage");
            const resolve = (values) => values.map((value) => this._resolveLanguage(value)).filter(Boolean);

            const recent = [...new Set(resolve([...this._recentLocal, ...this._recentSaved]))].slice(0, MAX_RECENT);
            const common = resolve(COMMON_LANGUAGES).filter((code) => !recent.includes(code));
            const codes = [...recent, ...common];
            const selected = this._resolveLanguage(target);
            if (selected && !codes.includes(selected)) codes.unshift(selected);

            const key = `${target}|${codes.join()}|${recent.join()}`;
            if (key === this._chipsKey) return;
            this._chipsKey = key;

            model.setProperty("/chips", codes.map((code) => ({
                code,
                name: this.getLanguageName(code),
                recent: recent.includes(code),
                pressed: code === target
            })));
        },

        async onCopy() {
            const value = this.getViewModel().getProperty("/translatedText").trim();
            if (!value) {
                MessageToast.show(this.text("nothingToCopy"));
                return;
            }

            try {
                await navigator.clipboard.writeText(value);
                MessageToast.show(this.text("copied"));
                const model = this.getViewModel();
                model.setProperty("/copyIcon", "sap-icon://accept");
                clearTimeout(this._copyTimer);
                this._copyTimer = setTimeout(() => model.setProperty("/copyIcon", "sap-icon://copy"), 2000);
            } catch (error) {
                const textarea = this.byId("translatedText").getFocusDomRef();
                if (textarea) {
                    textarea.focus();
                    textarea.select();
                }
                MessageToast.show(this.text("copyManually"));
            }
        },

        onClear() {
            const model = this.getViewModel();
            const hasText = model.getProperty("/sourceText").trim() || model.getProperty("/translatedText").trim();
            if (!hasText) {
                this._clearAll();
                return;
            }
            MessageBox.confirm(this.text("clearConfirm"), {
                onClose: (action) => {
                    if (action === MessageBox.Action.OK) this._clearAll();
                }
            });
        },

        _clearAll() {
            const model = this.getViewModel();
            model.setProperty("/sourceText", "");
            model.setProperty("/translatedText", "");
            model.setProperty("/targetLanguage", "");
            model.setProperty("/detected", "");
            model.setProperty("/terminologyNote", "");
            model.setProperty("/meta", "");
            model.setProperty("/review", emptyReview(model.getProperty("/review/testedBy")));
            this._last = null;
            this._setTranslatedLang(null);
            this._update();
            this.byId("sourceText").focus();
            MessageToast.show(this.text("cleared"));
        },

        onOutcomeSelect() {
            const model = this.getViewModel();
            const isFailure = model.getProperty("/review/outcomeIndex") === FAILURE_INDEX;
            model.setProperty("/review/accuracy", isFailure ? "0" : "");
            model.setProperty("/review/outcomeState", "None");
            model.setProperty("/review/accuracyState", "None");
            this._update();
        },

        async onSaveReview() {
            const model = this.getViewModel();
            const review = model.getProperty("/review");
            const outcome = OUTCOMES[review.outcomeIndex];
            const isFailure = review.outcomeIndex === FAILURE_INDEX;

            if (!outcome) {
                model.setProperty("/review/outcomeState", "Error");
                MessageToast.show(this.text("outcomeRequired"));
                this.byId("outcomeGroup").focus();
                return;
            }
            if (!review.testedBy.trim()) {
                model.setProperty("/review/testedByState", "Error");
                this.byId("testedBy").focus();
                return;
            }
            if (!this._last && !model.getProperty("/translatedText").trim()) {
                MessageToast.show(this.text("translateFirstMessage"));
                this.byId("sourceText").focus();
                return;
            }
            if (!isFailure) {
                const accuracy = parseFloat(review.accuracy);
                const error = String(review.accuracy).trim() === "" ? this.text("accuracyRequired")
                    : (Number.isNaN(accuracy) || accuracy < 0 || accuracy > 100) ? this.text("accuracyRange") : "";
                if (error) {
                    model.setProperty("/review/accuracyState", "Error");
                    model.setProperty("/review/accuracyStateText", error);
                    this.byId("accuracy").focus();
                    return;
                }
            }

            const accuracyValue = String(review.accuracy).trim();
            const record = {
                outcome,
                accuracy: accuracyValue === "" ? null : Number(accuracyValue),
                observation: review.observation,
                testedBy: review.testedBy,
                textToTranslate: this._last ? this._last.sourceText : model.getProperty("/sourceText"),
                translatedText: this._last ? this._last.translatedText : model.getProperty("/translatedText"),
                sourceLanguage: this._last ? this._last.sourceLanguage : "auto-Auto Detected",
                targetLanguage: this._last ? this._last.targetLanguage : this._displayName(model.getProperty("/targetLanguage")),
                sessionId: `session-${Date.now()}`
            };

            model.setProperty("/review/saving", true);
            this._update();
            try {
                await api.saveTestResult(record);
                model.setProperty("/sessionTests", model.getProperty("/sessionTests") + 1);
                model.setProperty("/review", emptyReview(review.testedBy));
                MessageToast.show(this.text("resultSaved"));
            } catch (error) {
                MessageBox.error(this.text("saveFailed", [this.errorMessage(error)]));
            } finally {
                model.setProperty("/review/saving", false);
                this._update();
            }
        },

        _addToHistory(entry) {
            const model = this.getViewModel();
            model.setProperty("/history", [entry, ...model.getProperty("/history")].slice(0, HISTORY_SIZE));
        },

        onHistoryPress(event) {
            const entry = event.getSource().getBindingContext("view").getObject();
            const model = this.getViewModel();
            model.setProperty("/sourceText", entry.sourceText);
            model.setProperty("/targetLanguage", entry.targetCode);
            model.setProperty("/meta", "");
            this._last = { ...entry.result };
            this._showResult(entry);
            this._update();
            this.byId("page").setHeaderExpanded(true);
            const scroller = this.byId("page").getScrollDelegate && this.byId("page").getScrollDelegate();
            if (scroller) scroller.scrollTo(0, 0, 300);
        },

        _onPropertyChange(path) {
            const model = this.getViewModel();
            if (path.startsWith("/chips/")) {
                return;
            }
            if (path === "/review/testedBy") model.setProperty("/review/testedByState", "None");
            if (path === "/review/accuracy") model.setProperty("/review/accuracyState", "None");
            this._update();
        },

        _update() {
            const model = this.getViewModel();
            const data = model.getData();
            const sourceText = data.sourceText || "";
            const hasText = sourceText.trim().length > 0;
            const hasLanguage = Boolean(data.targetLanguage);
            const tooLong = sourceText.length > MAX_CHARS;

            model.setProperty("/canTranslate", hasText && hasLanguage && !tooLong && !data.busy);
            model.setProperty("/translateHint",
                !hasText && !hasLanguage ? this.text("hintTextAndLanguage")
                    : !hasText ? this.text("hintText")
                        : !hasLanguage ? this.text("hintLanguage")
                            : tooLong ? this.text("textTooLong", [MAX_CHARS])
                                : this.text("translate"));

            this._updateChips();

            model.setProperty("/detectedText", data.detected
                ? this.text("detectedLanguage", [this.getLanguageName(data.detected)])
                : this.text("detectLanguage"));

            const review = data.review;
            const isFailure = review.outcomeIndex === FAILURE_INDEX;
            const hasTranslation = Boolean(this._last || (data.translatedText || "").trim());
            model.setProperty("/review/accuracyRequired", !isFailure);
            model.setProperty("/review/accuracyLabel", isFailure ? this.text("accuracyFailure") : this.text("accuracy"));
            model.setProperty("/review/accuracyPercent", Math.max(0, Math.min(100, parseFloat(review.accuracy) || 0)));
            model.setProperty("/review/canSave", hasTranslation && !review.saving);
            model.setProperty("/review/saveHint", hasTranslation ? this.text("saveHint") : this.text("translateFirst"));

            model.setProperty("/historyCount", String(data.history.length));
            model.setProperty("/sessionText", this.text("sessionStats", [data.sessionTranslations, data.sessionTests]));
        },

        _terminologyNote(terminology, labelType) {
            const parts = [];
            if (LABEL_TYPES[labelType]) {
                parts.push(this.text("labelType", [this.text(LABEL_TYPES[labelType])]));
            }
            if (terminology && terminology.skipped) {
                parts.push(this.text("terminologySkipped"));
            } else if (terminology) {
                if (terminology.official && terminology.official.length) {
                    parts.push(this.text("terminologyOfficial", [terminology.official.join(", ")]));
                }
                if (terminology.kept && terminology.kept.length) {
                    parts.push(this.text("terminologyKept", [terminology.kept.join(", ")]));
                }
            }
            return parts.join(" · ");
        },

        _displayName(code) {
            if (!code || code === "auto") return "auto-Auto Detected";
            const language = this.getLanguages().find((lang) => lang.code === code);
            return language && language.name ? `${code}-${language.name}` : code;
        },

        _hasUnsavedReview() {
            const review = this.getViewModel().getProperty("/review");
            return review.outcomeIndex >= 0 || String(review.accuracy).trim() !== "" || review.observation.trim() !== "";
        },

        _handleKeyDown(event) {
            if (!this._active || !(event.ctrlKey || event.metaKey)) return;
            if (event.key === "Enter") {
                event.preventDefault();
                if (this.getViewModel().getProperty("/canTranslate")) this.onTranslate();
            } else if (event.shiftKey && (event.key === "C" || event.key === "c")) {
                event.preventDefault();
                this.onCopy();
            }
        },

        _setTranslatedLang(code) {
            this._translatedLang = code || null;
            this._applyDomAttributes("translatedText");
        },

        _addDomAttributes(id, getAttributes) {
            this._domAttributes = this._domAttributes || {};
            this._domAttributes[id] = getAttributes;
            this.byId(id).addEventDelegate({ onAfterRendering: () => this._applyDomAttributes(id) });
        },

        _applyDomAttributes(id) {
            const textarea = this.byId(id).getFocusDomRef();
            if (!textarea) return;
            Object.entries(this._domAttributes[id]()).forEach(([name, value]) => {
                if (value) {
                    textarea.setAttribute(name, value);
                } else {
                    textarea.removeAttribute(name);
                }
            });
        }
    });
});
