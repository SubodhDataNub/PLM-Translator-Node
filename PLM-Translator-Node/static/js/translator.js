/**
 * DN Translator - Flask Edition
 * Frontend JavaScript functionality
 */

// Escape a value for safe insertion into innerHTML, including attribute values
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class DNTranslator {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.bindOutcomeChoices();
        this.updateCharacterCount();
        this.updateObservationCharacterCount();
        this.initializeLanguageRefresh();
        this.handleOutcomeChange(); // Initialize outcome-dependent field states
        this.updateSaveButtonState(); // Initialize save button state
        this.bindTabs();
        this.renderHistory();
    }

    initializeElements() {
        // Form elements
        this.sourceTextArea = document.getElementById('sourceText');
        this.targetLanguageSelect = document.getElementById('targetLanguage');
        this.translatedTextArea = document.getElementById('translatedText');
        this.languageSearchInput = document.getElementById('languageSearchInput');
        this.languageDropdown = document.querySelector('.language-dropdown');
        this.languageOptions = document.getElementById('languageOptions');
        this.dropdownArrow = document.querySelector('.language-selector .lang-toggle');
        this.detectedLanguage = document.getElementById('detectedLanguage');
        this.terminologyNote = document.getElementById('terminologyNote');

        // Test result elements
        this.outcomeSelect = document.getElementById('outcome');
        this.accuracyInput = document.getElementById('accuracy');
        this.testedByInput = document.getElementById('testedBy');
        this.observationTextArea = document.getElementById('observation');
        this.observationCharCount = document.getElementById('observationCharCount');
        this.accuracyProgress = document.getElementById('accuracyProgress');
        
        // Buttons
        this.translateBtn = document.getElementById('translateBtn');
        this.copyBtn = document.getElementById('copyBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.saveTestResultsBtn = document.getElementById('saveTestResultsBtn');
        this.viewTestResultsBtn = document.getElementById('viewTestResultsBtn');
        this.refreshTestResultsBtn = document.getElementById('refreshTestResultsBtn');
        this.exportExcelBtn = document.getElementById('exportExcelBtn');
        this.quickLangBtns = document.querySelectorAll('.quick-lang-btn');
        
        // UI elements
        this.charCount = document.getElementById('charCount');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.statusArea = document.getElementById('statusArea');
        this.testResultsModal = document.getElementById('testResultsModal');
        this.testResultsContainer = document.getElementById('testResultsContainer');
        this.resultCharCount = document.getElementById('resultCharCount');
        this.selectedLanguage = document.getElementById('selectedLanguage');
        this.processingTime = document.getElementById('processingTime');
        this.sessionTranslations = document.getElementById('sessionTranslations');
        this.sessionTests = document.getElementById('sessionTests');

        // Result details: metadata strip, review panel
        this.resultMeta = document.getElementById('resultMeta');
        this.translationTime = document.getElementById('translationTime');
        this.wordCount = document.getElementById('wordCount');
        this.reviewPanel = document.getElementById('reviewPanel');
        this.outcomeChoices = document.querySelectorAll('input[name="outcomeChoice"]');

        // Review / Recent tabs and this tab's translation history (memory only)
        this.wsTabs = document.querySelectorAll('.ws-tab');
        this.historyList = document.getElementById('historyList');
        this.historyEmpty = document.getElementById('historyEmpty');
        this.recentCount = document.getElementById('recentCount');
        this.history = [];

        // Form
        this.form = document.getElementById('translatorForm');
        
        // Store last translation result
        this.lastTranslationResult = null;
        
        // Store languages for lookup
        this.languages = [];
        
        // Session statistics
        this.sessionStats = {
            translations: 0,
            tests: 0
        };
        
        // Initialize with languages from HTML
        this.initializeLanguagesFromHTML();
    }

    initializeLanguagesFromHTML() {
        // Extract languages from the existing HTML options
        const options = this.targetLanguageSelect.querySelectorAll('option');
        this.languages = Array.from(options).map(option => ({
            key: option.value,
            text: option.textContent
        }));
    }

    bindEvents() {
        // Text input events
        this.sourceTextArea.addEventListener('input', () => {
            this.updateCharacterCount();
            this.autoResize(this.sourceTextArea);
            this.validateForm();
        });

        // Language selection change
        this.targetLanguageSelect.addEventListener('change', () => {
            this.validateForm();
            this.updateSelectedLanguageDisplay();
        });

        // Merged search-dropdown functionality
        if (this.languageSearchInput) {
            this.languageSearchInput.addEventListener('input', () => {
                this.filterLanguageOptions();
                // Only show dropdown if it's already visible or when typing
                if (!this.languageDropdown.classList.contains('d-none')) {
                    this.showLanguageDropdown();
                }
            });

            // Prevent input field from opening dropdown - only arrow should do that
            this.languageSearchInput.addEventListener('focus', (e) => {
                // Don't open dropdown on focus
            });

            this.languageSearchInput.addEventListener('blur', (e) => {
                // Only hide if clicking outside both input and dropdown
                setTimeout(() => {
                    const activeElement = document.activeElement;
                    const clickedElement = e.relatedTarget;
                    
                    // Don't hide if:
                    // 1. Mouse is over dropdown
                    // 2. Focus moved into dropdown
                    // 3. Clicked on the arrow (it will handle its own toggle)
                    if (this._isHoveringLanguageDropdown || 
                        (activeElement && this.languageDropdown.contains(activeElement)) ||
                        (clickedElement && clickedElement === this.dropdownArrow)) {
                        return;
                    }

                    this.hideLanguageDropdown();
                }, 200);
            });

            // Track mouse over the dropdown to avoid flicker when moving between input and list
            if (this.languageDropdown) {
                this._isHoveringLanguageDropdown = false;
                this.languageDropdown.addEventListener('mouseenter', () => {
                    this._isHoveringLanguageDropdown = true;
                });
                this.languageDropdown.addEventListener('mouseleave', () => {
                    this._isHoveringLanguageDropdown = false;
                    // If the input is not focused when mouse leaves, hide the dropdown
                    if (document.activeElement !== this.languageSearchInput) {
                        // Small timeout to avoid race with focus events
                        setTimeout(() => {
                            if (!this._isHoveringLanguageDropdown && document.activeElement !== this.languageSearchInput) {
                                this.hideLanguageDropdown();
                            }
                        }, 100);
                    }
                });
            }

            // Keyboard navigation
            this.languageSearchInput.addEventListener('keydown', (e) => {
                this.handleKeyboardNavigation(e);
            });
        }

        // Dropdown arrow click handling - only way to open dropdown
        if (this.dropdownArrow) {
            // Prevent blur when mousedown on arrow
            this.dropdownArrow.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            
            this.dropdownArrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Toggle dropdown visibility
                if (this.languageDropdown.classList.contains('d-none')) {
                    // Start each search from the full list
                    this.languageSearchInput.value = '';
                    this.filterLanguageOptions();
                    this.showLanguageDropdown();
                    // Focus input for typing
                    setTimeout(() => {
                        this.languageSearchInput.focus();
                    }, 10);
                } else {
                    this.hideLanguageDropdown();
                }
            });
        }

        // Language option click handling
        if (this.languageOptions) {
            this.languageOptions.addEventListener('click', (e) => {
                if (e.target.classList.contains('language-option')) {
                    const value = e.target.getAttribute('data-value');
                    const text = e.target.getAttribute('data-text');
                    this.selectLanguageOption(value, text);
                }
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.language-selector')) {
                this.hideLanguageDropdown();
            }
        });

        // Quick language buttons
        this.quickLangBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const langCode = btn.getAttribute('data-lang');
                this.selectLanguage(langCode);
            });
        });

        // Accuracy input for progress bar
        if (this.accuracyInput) {
            this.accuracyInput.addEventListener('input', () => {
                this.updateAccuracyProgress();
            });
        }

        // Button events
        this.translateBtn.addEventListener('click', () => this.translateText());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.saveTestResultsBtn.addEventListener('click', () => this.saveTestResults());
        // The "View All Results" button may be removed from the Single Translation page.
        // Guard the event binding to avoid runtime errors when the element is absent.
        if (this.viewTestResultsBtn) {
            this.viewTestResultsBtn.addEventListener('click', () => this.showTestResultsModal());
        }
        // Guard refresh/export buttons - they may be part of a modal that was removed from this page
        if (this.refreshTestResultsBtn) {
            this.refreshTestResultsBtn.addEventListener('click', () => {
                // Add visual feedback to refresh button
                const originalHtml = this.refreshTestResultsBtn.innerHTML;
                this.refreshTestResultsBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Refreshing...';
                this.refreshTestResultsBtn.disabled = true;
                
                // Only attempt to load test results if container exists
                this.loadTestResults().finally(() => {
                    // Reset button state
                    this.refreshTestResultsBtn.innerHTML = originalHtml;
                    this.refreshTestResultsBtn.disabled = false;
                });
            });
        }

        if (this.exportExcelBtn) {
            this.exportExcelBtn.addEventListener('click', () => this.exportToExcel());
        }

        // Event delegation for dynamically created delete buttons (only if container exists)
        if (this.testResultsContainer) {
            this.testResultsContainer.addEventListener('click', (e) => {
                if (e.target.closest('.delete-result-btn')) {
                    const deleteBtn = e.target.closest('.delete-result-btn');
                    const resultId = deleteBtn.getAttribute('data-result-id');
                    if (resultId) {
                        this.deleteTestResult(parseInt(resultId));
                    }
                }
            });
        }

        // Test result events
        this.observationTextArea.addEventListener('input', () => {
            this.updateObservationCharacterCount();
        });

        // Outcome selection change event
        this.outcomeSelect.addEventListener('change', () => {
            this.handleOutcomeChange();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+Enter to translate
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!this.translateBtn.disabled) {
                    this.translateText();
                }
            }
            
            // Ctrl+Shift+C to copy
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
                e.preventDefault();
                this.copyToClipboard();
            }
        });

        // Form submission
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.translateText();
        });
    }

    updateCharacterCount() {
        const currentLength = this.sourceTextArea.value.length;
        this.charCount.textContent = currentLength;
        
        // Update color based on character count
        if (currentLength > 4500) {
            this.charCount.style.color = 'var(--danger)';
        } else if (currentLength > 4000) {
            this.charCount.style.color = 'var(--warning)';
        } else {
            this.charCount.style.color = ''; // Default muted color from the stylesheet
        }
    }

    validateForm() {
        const hasText = this.sourceTextArea.value.trim().length > 0;
        const hasLanguage = this.targetLanguageSelect.value !== '';
        
        this.translateBtn.disabled = !(hasText && hasLanguage);
        
        // Update button text based on state
        if (!hasText && !hasLanguage) {
            this.translateBtn.innerHTML = '<i class="fas fa-language me-2"></i>Enter text & select language';
        } else if (!hasText) {
            this.translateBtn.innerHTML = '<i class="fas fa-language me-2"></i>Enter text to translate';
        } else if (!hasLanguage) {
            this.translateBtn.innerHTML = '<i class="fas fa-language me-2"></i>Select target language';
        } else {
            this.translateBtn.innerHTML = '<i class="fas fa-language me-2"></i>Translate';
        }
    }

    handleOutcomeChange() {
        const selectedOutcome = this.outcomeSelect.value;
        
        if (selectedOutcome === 'Failure') {
            // Disable accuracy field for Failure outcome
            this.accuracyInput.disabled = true;
            this.accuracyInput.required = false;
            this.accuracyInput.value = '0'; // Set to 0 for failures
            
            // Update the label to indicate it's disabled
            const accuracyLabel = document.querySelector('label[for="accuracy"]');
            if (accuracyLabel) {
                accuracyLabel.innerHTML = 'Accuracy (%) <span class="text-muted">· set to 0 for failures</span>';
            }
        } else {
            // Enable accuracy field for Success and Partial outcomes
            this.accuracyInput.disabled = false;
            this.accuracyInput.required = true;
            this.accuracyInput.value = ''; // Clear the value so user can input
            
            // Restore the original label
            const accuracyLabel = document.querySelector('label[for="accuracy"]');
            if (accuracyLabel) {
                accuracyLabel.innerHTML = 'Accuracy (%) <span class="req">*</span>';
            }
        }
    }

    updateSaveButtonState() {
        // Enable save button only if translation has been performed
        const hasTranslation = this.lastTranslationResult || 
                              (this.translatedTextArea.value && this.translatedTextArea.value.trim() !== '');
        
        this.saveTestResultsBtn.disabled = !hasTranslation;
        
        if (hasTranslation) {
            this.saveTestResultsBtn.innerHTML = '<i class="fas fa-save me-2"></i>Save Test Results';
            this.saveTestResultsBtn.title = 'Save test results for the current translation';
        } else {
            this.saveTestResultsBtn.innerHTML = '<i class="fas fa-save me-2"></i>Translate text first';
            this.saveTestResultsBtn.title = 'You must translate text before saving test results';
        }
    }

    // Updated methods for merged search-dropdown functionality
    filterLanguageOptions() {
        const searchTerm = this.languageSearchInput.value.toLowerCase();
        const options = this.languageOptions.querySelectorAll('.language-option');
        
        // Clear keyboard navigation state when filtering
        options.forEach(option => {
            option.classList.remove('keyboard-active');
            
            const text = option.getAttribute('data-text').toLowerCase();
            const value = option.getAttribute('data-value').toLowerCase();
            
            if (text.includes(searchTerm) || value.includes(searchTerm)) {
                option.style.display = 'block';
            } else {
                option.style.display = 'none';
            }
        });
    }

    showLanguageDropdown() {
        this.languageDropdown.classList.remove('d-none');
        // The toggle's chevron turns via CSS while the list is open
        if (this.dropdownArrow) {
            this.dropdownArrow.setAttribute('aria-expanded', 'true');
        }
    }

    hideLanguageDropdown() {
        this.languageDropdown.classList.add('d-none');
        if (this.dropdownArrow) {
            this.dropdownArrow.setAttribute('aria-expanded', 'false');
        }
    }

    selectLanguageOption(value, text) {
        this.languageSearchInput.value = text;
        this.targetLanguageSelect.value = value;
        this.hideLanguageDropdown();
        this.validateForm();
        this.updateSelectedLanguageDisplay();
    }

    handleKeyboardNavigation(e) {
        const visibleOptions = Array.from(this.languageOptions.querySelectorAll('.language-option'))
            .filter(option => option.style.display !== 'none');
        
        if (visibleOptions.length === 0) return;

        const currentActive = this.languageOptions.querySelector('.language-option.keyboard-active');
        let newIndex = -1;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (currentActive) {
                    newIndex = visibleOptions.indexOf(currentActive) + 1;
                } else {
                    newIndex = 0;
                }
                if (newIndex >= visibleOptions.length) newIndex = 0;
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (currentActive) {
                    newIndex = visibleOptions.indexOf(currentActive) - 1;
                } else {
                    newIndex = visibleOptions.length - 1;
                }
                if (newIndex < 0) newIndex = visibleOptions.length - 1;
                break;

            case 'Enter':
                e.preventDefault();
                if (currentActive) {
                    const value = currentActive.getAttribute('data-value');
                    const text = currentActive.getAttribute('data-text');
                    this.selectLanguageOption(value, text);
                } else if (visibleOptions.length === 1) {
                    const value = visibleOptions[0].getAttribute('data-value');
                    const text = visibleOptions[0].getAttribute('data-text');
                    this.selectLanguageOption(value, text);
                }
                return;

            case 'Escape':
                e.preventDefault();
                this.hideLanguageDropdown();
                return;
        }

        if (newIndex >= 0) {
            // Remove previous active state
            if (currentActive) {
                currentActive.classList.remove('keyboard-active');
            }
            
            // Add new active state
            visibleOptions[newIndex].classList.add('keyboard-active');
            visibleOptions[newIndex].scrollIntoView({ block: 'nearest' });
            
            if (!this.languageDropdown.classList.contains('d-none')) {
                this.showLanguageDropdown();
            }
        }
    }

    selectLanguage(langCode) {
        // Find the option with the given language code (fall back to the base code, e.g. 'zh-CN' -> 'zh')
        const option = this.languageOptions.querySelector(`[data-value="${langCode}"]`)
            || this.languageOptions.querySelector(`[data-value="${langCode.split('-')[0]}"]`);
        if (option) {
            const text = option.getAttribute('data-text');
            this.selectLanguageOption(option.getAttribute('data-value'), text);
        }
    }

    /**
     * Highlight the quick chip for the selected language. A language without a quick chip
     * gets its own highlighted chip in front of them.
     */
    updateSelectedLanguageDisplay() {
        const selectedOption = this.targetLanguageSelect.selectedOptions[0];
        const value = selectedOption ? selectedOption.value : '';
        let matched = false;

        this.quickLangBtns.forEach((btn) => {
            const lang = btn.getAttribute('data-lang');
            const isSelected = Boolean(value) && (lang === value || lang.split('-')[0] === value);
            btn.classList.toggle('is-active', isSelected);
            btn.setAttribute('aria-pressed', String(isSelected));
            if (isSelected) matched = true;
        });

        if (value && !matched) {
            this.selectedLanguage.textContent = selectedOption.textContent;
            this.selectedLanguage.hidden = false;
        } else {
            this.selectedLanguage.textContent = '';
            this.selectedLanguage.hidden = true;
        }
    }

    updateAccuracyProgress() {
        const accuracy = parseFloat(this.accuracyInput.value) || 0;
        this.accuracyProgress.style.width = `${Math.min(accuracy, 100)}%`;
        
        // Update progress bar color based on accuracy
        this.accuracyProgress.className = 'progress-bar';
        if (accuracy >= 90) {
            this.accuracyProgress.classList.add('bg-primary');
        } else if (accuracy >= 70) {
            this.accuracyProgress.classList.add('bg-primary');
        } else {
            this.accuracyProgress.classList.add('bg-secondary');
        }
    }

    updateSessionStats() {
        this.sessionTranslations.textContent = this.sessionStats.translations;
        this.sessionTests.textContent = this.sessionStats.tests;
    }

    updateResultCharCount() {
        const count = this.countCharacters(this.translatedTextArea.value);
        this.resultCharCount.textContent = `${count} chars`;
    }

    async translateText() {
        const sourceText = this.sourceTextArea.value.trim();
        const targetLanguage = this.targetLanguageSelect.value;

        // Validation
        if (!sourceText) {
            this.showAlert('Please enter text to translate.', 'warning');
            this.sourceTextArea.focus();
            return;
        }

        if (!targetLanguage) {
            this.showAlert('Please select a target language.', 'warning');
            this.targetLanguageSelect.focus();
            return;
        }

        if (sourceText.length > 5000) {
            this.showAlert('Text is too long. Maximum 5000 characters allowed.', 'danger');
            return;
        }

        // Show loading state
        this.setLoadingState(true);
        this.showTerminologyNote(null);
        const startedAt = performance.now(); // round trip shown in the metadata strip

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: sourceText,
                    target_language: targetLanguage
                })
            });

            const data = await response.json();

            if (data.success) {
                // Store the translation result for later use
                this.lastTranslationResult = {
                    source_text: sourceText,
                    translated_text: data.translated_text,
                    source_language: this.getLanguageDisplayName(data.source_language),
                    target_language: this.getLanguageDisplayName(targetLanguage)
                };
                
                // Display translation result
                this.translatedTextArea.value = data.translated_text;
                this.autoResize(this.translatedTextArea);
                this.setDetectedLanguage(data.source_language);
                this.showTerminologyNote(data.terminology, data.label_type);
                this.copyBtn.disabled = false;
                
                // Update session statistics
                this.sessionStats.translations++;
                this.updateSessionStats();
                this.updateResultCharCount();
                
                // Update save button state since we now have a translation
                this.updateSaveButtonState();
                
                // Show success message
                const targetLangName = this.targetLanguageSelect.options[this.targetLanguageSelect.selectedIndex].text;
                this.showAlert(`Translation completed successfully to ${targetLangName}`, 'success');
                
                // Add fade-in animation
                this.translatedTextArea.parentElement.classList.add('fade-in-up');

                // Metadata strip and review panel (display only)
                this.showResultDetails(data.translated_text, targetLanguage, performance.now() - startedAt);

                this.addToHistory({
                    sourceText,
                    translatedText: data.translated_text,
                    sourceCode: data.source_language,
                    targetCode: targetLanguage,
                    targetName: targetLangName,
                    terminology: data.terminology,
                    labelType: data.label_type,
                    result: { ...this.lastTranslationResult }
                });

            } else {
                throw new Error(data.error || 'Translation failed');
            }

        } catch (error) {
            console.error('Translation error:', error);
            
            // Show error message
            if (error.message.includes('fetch')) {
                this.showAlert('Network error. Please check your connection and try again.', 'danger');
            } else {
                this.showAlert(`Translation failed: ${error.message}`, 'danger');
            }
            
            // Clear result area
            this.translatedTextArea.value = '';
            this.autoResize(this.translatedTextArea);
            this.copyBtn.disabled = true;
            this.hideResultDetails();
        } finally {
            this.setLoadingState(false);
        }
    }

    async copyToClipboard() {
        const textToCopy = this.translatedTextArea.value.trim();

        if (!textToCopy) {
            this.showAlert('No translation text available to copy.', 'info');
            return;
        }

        try {
            // Modern clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(textToCopy);
                this.showAlert('Translation copied to clipboard successfully!', 'success');
                
                // Temporary button feedback: the copy icon turns into a check
                this.copyBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
                this.copyBtn.classList.add('is-done');

                setTimeout(() => {
                    this.copyBtn.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i>';
                    this.copyBtn.classList.remove('is-done');
                }, 2000);
                
            } else {
                // Fallback for older browsers or non-secure contexts
                this.selectText(this.translatedTextArea);
                document.execCommand('copy');
                this.showAlert('Text selected. Use Ctrl+C to copy.', 'info');
            }
        } catch (error) {
            console.error('Copy failed:', error);
            
            // Final fallback - select text for manual copy
            this.selectText(this.translatedTextArea);
            this.showAlert('Please use Ctrl+C to copy the selected text.', 'warning');
        }
    }

    selectText(element) {
        element.focus();
        element.select();
        
        // For mobile devices
        if (element.setSelectionRange) {
            element.setSelectionRange(0, 99999);
        }
    }

    /**
     * Show the label type the server detected and the official wording and protected terms it
     * applied (nothing for null)
     */
    showTerminologyNote(terminology, labelType) {
        if (!this.terminologyNote) return;
        const labelTypeNames = { general: 'General', food: 'Food', cosmetic: 'Cosmetic or detergent' };
        const parts = [];
        if (labelTypeNames[labelType]) {
            parts.push(`Label type: ${labelTypeNames[labelType]}`);
        }
        if (terminology && terminology.skipped) {
            parts.push('Label terminology could not be applied to this text, so it was translated without it.');
        } else if (terminology) {
            if (terminology.official && terminology.official.length) {
                parts.push(`Official wording: ${terminology.official.join(', ')}`);
            }
            if (terminology.kept && terminology.kept.length) {
                parts.push(`Kept as written: ${terminology.kept.join(', ')}`);
            }
        }
        this.terminologyNote.textContent = parts.join(' · ');
        this.terminologyNote.hidden = parts.length === 0;
    }

    /**
     * The outcome stamps are radio buttons that write to the hidden #outcome select, which stays
     * the source of truth for validation, saving and the unsaved-changes warning.
     */
    bindOutcomeChoices() {
        if (!this.outcomeChoices.length) return;

        this.outcomeChoices.forEach((choice) => {
            choice.addEventListener('change', () => {
                if (!choice.checked) return;
                this.outcomeSelect.value = choice.value;
                this.outcomeSelect.dispatchEvent(new Event('change'));
            });
        });
        this.outcomeSelect.addEventListener('change', () => this.syncOutcomeChoices());

        // Validation focuses the select; move focus to the visible stamps instead
        this.outcomeSelect.addEventListener('focus', () => {
            const choices = Array.from(this.outcomeChoices);
            (choices.find((choice) => choice.checked) || choices[0]).focus();
        });
    }

    syncOutcomeChoices() {
        this.outcomeChoices.forEach((choice) => {
            choice.checked = choice.value === this.outcomeSelect.value;
        });
    }

    /**
     * Show the metadata strip for a finished translation and open the review panel.
     * Display only: nothing here touches the request or the saved result.
     */
    showResultDetails(translatedText, targetLanguage, elapsedMs) {
        // Lets the browser choose the right glyphs (e.g. Japanese vs Chinese) and voice
        this.translatedTextArea.lang = targetLanguage;

        if (this.resultMeta) {
            this.translationTime.textContent = Math.round(elapsedMs).toLocaleString();
            this.wordCount.textContent = this.countWords(translatedText, targetLanguage).toLocaleString();
            this.resultMeta.hidden = false;
        }

        // Bring the review form forward for the new translation
        this.selectTab('tabReview');
    }

    hideResultDetails() {
        this.translatedTextArea.removeAttribute('lang');
        if (this.resultMeta) this.resultMeta.hidden = true;
    }

    /** Count user-perceived characters, so combining marks (Devanagari, Arabic) count once */
    countCharacters(text) {
        if (window.Intl && Intl.Segmenter) {
            return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
        }
        return Array.from(text).length;
    }

    /** Count words; Intl.Segmenter also handles scripts written without spaces (Chinese, Japanese, Thai) */
    countWords(text, language) {
        if (window.Intl && Intl.Segmenter) {
            let segmenter;
            try {
                segmenter = new Intl.Segmenter(language, { granularity: 'word' });
            } catch (error) {
                segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
            }
            return Array.from(segmenter.segment(text)).filter((segment) => segment.isWordLike).length;
        }
        return text.trim().split(/\s+/).filter(Boolean).length;
    }

    clearAll() {
        // Show confirmation dialog
        if (this.sourceTextArea.value.trim() || this.translatedTextArea.value.trim()) {
            if (!confirm('Are you sure you want to clear all fields?')) {
                return;
            }
        }

        // Clear all fields
        this.sourceTextArea.value = '';
        this.translatedTextArea.value = '';
        this.autoResize(this.sourceTextArea);
        this.autoResize(this.translatedTextArea);
        this.setDetectedLanguage(null);
        this.showTerminologyNote(null);
        this.hideResultDetails();
        this.targetLanguageSelect.value = '';
        
        // Clear merged search input
        if (this.languageSearchInput) {
            this.languageSearchInput.value = '';
            this.hideLanguageDropdown();
        }
        
        // Clear test result fields
        this.clearTestResults();
        
        // Clear translation result
        this.lastTranslationResult = null;
        
        // Reset UI state
        this.copyBtn.disabled = true;
        this.updateCharacterCount();
        this.updateResultCharCount();
        this.updateSelectedLanguageDisplay();
        this.validateForm();
        this.updateSaveButtonState(); // Update save button state since translation is cleared
        
        // Clear status messages
        this.clearAlerts();
        
        // Focus on source text area
        this.sourceTextArea.focus();
        
        this.showAlert('All fields have been cleared.', 'info');
    }

    /** Grow a pane's text box with its content (CSS sets the minimum) and shrink the type for long text */
    autoResize(textarea) {
        if (!textarea) return;
        textarea.classList.toggle('is-long', textarea.value.length > 160);
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    /** Show the language the server detected in the source pane's chip (null resets it) */
    setDetectedLanguage(code) {
        if (!this.detectedLanguage) return;
        if (!code || code === 'auto') {
            this.detectedLanguage.textContent = 'Detect language';
            return;
        }
        this.detectedLanguage.textContent = `${this.getLanguageName(code)} · detected`;
    }

    getLanguageName(code) {
        if (!code || code === 'auto') return 'Detected';
        const base = String(code).split('-')[0];
        const language = this.languages.find((lang) => lang.key === code)
            || this.languages.find((lang) => lang.key && lang.key.split('-')[0] === base);
        return language && language.text ? language.text : code;
    }

    /** Review / Recent tabs: click, or arrow keys while a tab has focus */
    bindTabs() {
        const tabs = Array.from(this.wsTabs);
        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => this.selectTab(tab.id));
            tab.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                this.selectTab(next.id);
                next.focus();
            });
        });
    }

    selectTab(tabId) {
        this.wsTabs.forEach((tab) => {
            const isActive = tab.id === tabId;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
            const panel = document.getElementById(tab.getAttribute('aria-controls'));
            if (panel) panel.hidden = !isActive;
        });
    }

    /** Keep the last translations of this tab (memory only; nothing is stored in the browser) */
    addToHistory(entry) {
        this.history.unshift(entry);
        this.history = this.history.slice(0, 12);
        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyList) return;
        this.historyList.replaceChildren();
        this.recentCount.textContent = this.history.length;
        this.historyEmpty.hidden = this.history.length > 0;

        this.history.forEach((entry, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'history-card';
            card.title = 'Load this translation again';

            const route = document.createElement('span');
            route.className = 'chip chip--sm is-active';
            const arrow = document.createElement('i');
            arrow.className = 'fas fa-chevron-right';
            arrow.setAttribute('aria-hidden', 'true');
            route.append(this.getLanguageName(entry.sourceCode), arrow, entry.targetName);

            const source = document.createElement('span');
            source.className = 'history-source';
            source.dir = 'auto';
            source.textContent = entry.sourceText;

            const translated = document.createElement('span');
            translated.className = 'history-target';
            translated.dir = 'auto';
            translated.lang = entry.targetCode;
            translated.textContent = entry.translatedText;

            card.append(route, source, translated);
            card.addEventListener('click', () => this.restoreHistory(index));
            this.historyList.appendChild(card);
        });
    }

    /** Load a recent translation back into the panes so it can be copied or reviewed */
    restoreHistory(index) {
        const entry = this.history[index];
        if (!entry) return;

        this.sourceTextArea.value = entry.sourceText;
        const option = this.languageOptions.querySelector(`[data-value="${CSS.escape(entry.targetCode)}"]`);
        this.selectLanguageOption(entry.targetCode, option ? option.getAttribute('data-text') : entry.targetName);
        this.translatedTextArea.value = entry.translatedText;
        this.translatedTextArea.lang = entry.targetCode;
        this.lastTranslationResult = { ...entry.result };

        this.setDetectedLanguage(entry.sourceCode);
        this.showTerminologyNote(entry.terminology, entry.labelType);
        this.copyBtn.disabled = false;
        this.autoResize(this.sourceTextArea);
        this.autoResize(this.translatedTextArea);
        this.updateCharacterCount();
        this.updateResultCharCount();
        if (this.resultMeta) this.resultMeta.hidden = true; // timing belongs to the original run
        this.validateForm();
        this.updateSaveButtonState();

        this.selectTab('tabReview');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    setLoadingState(loading) {
        if (loading) {
            this.loadingOverlay.classList.remove('d-none');
            this.translateBtn.disabled = true;
            this.translateBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Translating...';
            
            // Disable form elements
            this.sourceTextArea.disabled = true;
            this.targetLanguageSelect.disabled = true;
            this.clearBtn.disabled = true;
            
        } else {
            this.loadingOverlay.classList.add('d-none');
            this.translateBtn.disabled = false;
            
            // Re-enable form elements
            this.sourceTextArea.disabled = false;
            this.targetLanguageSelect.disabled = false;
            this.clearBtn.disabled = false;
            
            // Restore button text
            this.validateForm();
        }
    }

    showAlert(message, type = 'info') {
        this.clearAlerts();
        
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show status-message`;
        alertDiv.innerHTML = `
            <i class="fas fa-${this.getAlertIcon(type)} me-2"></i>
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        this.statusArea.appendChild(alertDiv);
        
        // Auto-dismiss success and info messages
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                if (alertDiv.parentNode) {
                    alertDiv.remove();
                }
            }, 5000);
        }
        
        // Scroll to alert if needed
        alertDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    getAlertIcon(type) {
        const icons = {
            'success': 'check-circle',
            'danger': 'exclamation-triangle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    clearAlerts() {
        const alerts = this.statusArea.querySelectorAll('.alert');
        alerts.forEach(alert => alert.remove());
    }

    async initializeLanguageRefresh() {
        // Optionally refresh languages from API on page load
        try {
            const response = await fetch('/api/languages');
            const data = await response.json();
            
            if (data.success && data.languages.length > 1) {
                // Update language dropdown if API provides more languages
                this.updateLanguageOptions(data.languages);
                
                // Show info about loaded languages
                const languageCount = data.languages.length - 1; // Exclude placeholder
                console.log(`Loaded ${languageCount} languages from API`);
            }
        } catch (error) {
            console.log('Using fallback languages (API unavailable)');
        }
    }

    updateLanguageOptions(languages) {
        const currentValue = this.targetLanguageSelect.value;
        
        // Store languages for lookup
        this.languages = languages;
        
        // Clear existing options
        this.targetLanguageSelect.innerHTML = '';
        
        // Add new options
        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.key;
            option.textContent = lang.text;
            this.targetLanguageSelect.appendChild(option);
        });
        
        // Restore selection if still valid
        if (currentValue && languages.some(lang => lang.key === currentValue)) {
            this.targetLanguageSelect.value = currentValue;
        }
        
        this.validateForm();
    }

    getLanguageDisplayName(languageKey) {
        // Helper function to convert language key to "key-Name" format
        if (!languageKey || languageKey === 'auto') {
            return 'auto-Auto Detected';
        }
        
        // Find language name from stored languages
        const language = this.languages.find(lang => lang.key === languageKey);
        if (language && language.text) {
            return `${languageKey}-${language.text}`;
        }
        
        // Fallback to just the key if name not found
        return languageKey;
    }

    updateObservationCharacterCount() {
        const currentLength = this.observationTextArea.value.length;
        this.observationCharCount.textContent = currentLength;
        
        // Update color based on character count
        if (currentLength > 450) {
            this.observationCharCount.style.color = 'var(--danger)';
        } else if (currentLength > 400) {
            this.observationCharCount.style.color = 'var(--warning)';
        } else {
            this.observationCharCount.style.color = ''; // Default muted color from the stylesheet
        }
    }

    async saveTestResults() {
        try {
            // Validate required fields
            if (!this.outcomeSelect.value) {
                this.showError('Please select an outcome');
                this.outcomeSelect.focus();
                return;
            }

            // Validate tested by field
            if (!this.testedByInput.value || this.testedByInput.value.trim() === '') {
                this.showError('Please enter who tested this translation');
                this.testedByInput.focus();
                return;
            }

            // Validate that translation has been performed
            if (!this.lastTranslationResult && (!this.translatedTextArea.value || this.translatedTextArea.value.trim() === '')) {
                this.showError('Please translate text before saving test results');
                this.sourceTextArea.focus();
                return;
            }

            // Only validate accuracy if outcome is not "Failure"
            if (this.outcomeSelect.value !== 'Failure') {
                if (!this.accuracyInput.value || this.accuracyInput.value.trim() === '') {
                    this.showError('Please enter an accuracy percentage');
                    this.accuracyInput.focus();
                    return;
                }

                // Validate accuracy range
                const accuracy = parseFloat(this.accuracyInput.value);
                if (isNaN(accuracy) || accuracy < 0 || accuracy > 100) {
                    this.showError('Accuracy must be a number between 0 and 100');
                    this.accuracyInput.focus();
                    return;
                }
            }

            const testResults = {
                outcome: this.outcomeSelect.value,
                accuracy: this.accuracyInput.value,
                observation: this.observationTextArea.value,
                testedBy: this.testedByInput.value,
                sourceText: this.lastTranslationResult?.source_text || this.sourceTextArea.value,
                translatedText: this.lastTranslationResult?.translated_text || this.translatedTextArea.value,
                sourceLanguage: this.lastTranslationResult?.source_language || 'auto-Auto Detected',
                targetLanguage: this.lastTranslationResult?.target_language || this.getLanguageDisplayName(this.targetLanguageSelect.value),
                sessionId: `session-${Date.now()}`,
                timestamp: new Date().toISOString()
            };

            // Show loading state
            this.saveTestResultsBtn.disabled = true;
            this.saveTestResultsBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';

            console.log('Sending test results:', testResults); // Debug log

            const response = await fetch('/api/save-test-results', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(testResults)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Save response:', result); // Debug log
                
                // Update session statistics
                this.sessionStats.tests++;
                this.updateSessionStats();
                
                this.showSuccess('Test result saved');
                // Optionally clear the test results form
                this.clearTestResults();
                // Enable the view button if it was disabled (only if present)
                if (this.viewTestResultsBtn) {
                    this.viewTestResultsBtn.disabled = false;
                }
            } else {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                console.error('Save error response:', error); // Debug log
                throw new Error(error.message || 'Failed to save test results');
            }
        } catch (error) {
            console.error('Error saving test results:', error);
            this.showError('Failed to save test results: ' + error.message);
        } finally {
            // Reset button state
            this.saveTestResultsBtn.disabled = false;
            this.saveTestResultsBtn.innerHTML = '<i class="fas fa-save me-2"></i>Save Test Results';
        }
    }

    clearTestResults() {
        this.outcomeSelect.value = '';
        this.accuracyInput.value = '';
        this.observationTextArea.value = '';
        this.updateObservationCharacterCount();
        this.syncOutcomeChoices();

        // Reset accuracy progress bar
        if (this.accuracyProgress) {
            this.accuracyProgress.style.width = '0%';
            this.accuracyProgress.className = 'progress-bar bg-success';
        }
    }

    showTestResultsModal() {
        // Show the modal (if it exists) and load results
        if (!this.testResultsModal) {
            console.warn('Test results modal is not available on this page.');
            return;
        }

        const modal = new bootstrap.Modal(this.testResultsModal);
        modal.show();
        
        // Load test results
        this.loadTestResults();
    }

    async loadTestResults() {
        // If there's no container available (modal removed), do nothing
        if (!this.testResultsContainer) {
            console.warn('Test results container not found; skipping loadTestResults.');
            return;
        }

        try {
            // Show loading state
            this.testResultsContainer.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="mt-2">Loading test results...</div>
                </div>
            `;

            // Add timeout to prevent infinite loading
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            // Add cache-busting parameter to ensure fresh data
            const response = await fetch(`/api/test-results?_t=${Date.now()}`, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                this.displayTestResults(data.data || []);
            } else {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading test results:', error);
            
            let errorMessage = 'Failed to load test results';
            if (error.name === 'AbortError') {
                errorMessage = 'Request timed out. Please try again.';
            } else if (error.message.includes('fetch')) {
                errorMessage = 'Network error. Please check your connection.';
            } else {
                errorMessage = error.message;
            }
            
                this.testResultsContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${escapeHtml(errorMessage)}
                    <br>
                    <button class="btn btn-sm btn-outline-light mt-2" onclick="translator.loadTestResults()">
                        <i class="fas fa-sync me-1"></i>Try Again
                    </button>
                </div>
            `;
        }
    }

    displayTestResults(results) {
        if (!this.testResultsContainer) {
            console.warn('Test results container not available; skipping displayTestResults.');
            return;
        }

        if (results.length === 0) {
            this.testResultsContainer.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-clipboard me-2"></i>
                    No test results found. Save some test results first!
                </div>
            `;
            return;
        }

        let html = '<div class="row">';
        results.forEach((result, index) => {
            const date = new Date(result.created_at).toLocaleString();
            html += `
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h6 class="mb-0">Test Result #${escapeHtml(result.id || index + 1)}</h6>
                            <div class="d-flex gap-2">
                                <span class="badge ${result.outcome === 'Success' ? 'bg-success' : 'bg-warning'}">${escapeHtml(result.outcome)}</span>
                                <button class="btn btn-outline-danger btn-sm delete-result-btn" data-result-id="${escapeHtml(result.id)}" title="Delete this result">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="row">
                                <div class="col-6">
                                    <strong>Accuracy:</strong> ${escapeHtml(result.accuracy || 'N/A')}%
                                </div>
                                <div class="col-6">
                                    <strong>Tested By:</strong> ${escapeHtml(result.tested_by || 'N/A')}
                                </div>
                            </div>
                            <div class="mt-2">
                                <strong>Observation:</strong>
                                <p class="text-muted small mb-1">${escapeHtml(result.observation || 'No observation provided')}</p>
                            </div>
                            <div class="mt-2">
                                <strong>Translation:</strong>
                                <p class="text-muted small mb-1">${escapeHtml(result.text_to_translate ? result.text_to_translate.substring(0, 50) + '...' : 'N/A')} → ${escapeHtml(result.translated_text ? result.translated_text.substring(0, 50) + '...' : 'N/A')}</p>
                            </div>
                            <div class="mt-2">
                                <strong>Languages:</strong>
                                <p class="text-muted small mb-1">
                                    <i class="fas fa-arrow-right me-1"></i>
                                    ${escapeHtml(result.source_language || 'auto-Auto Detected')} → ${escapeHtml(result.target_language || 'N/A')}
                                </p>
                            </div>
                            <div class="text-muted small">
                                <i class="fas fa-clock me-1"></i>${escapeHtml(date)}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        
        this.testResultsContainer.innerHTML = html;
    }

    async exportToExcel() {
        try {
            // Show loading state
            this.exportExcelBtn.disabled = true;
            this.exportExcelBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Exporting...';

            const response = await fetch('/api/export-test-results');
            if (response.ok) {
                // Create a blob from the response
                const blob = await response.blob();
                
                // Create download link
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `test_results_${new Date().toISOString().split('T')[0]}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                this.showSuccess('Test results exported successfully!');
            } else {
                throw new Error('Failed to export test results');
            }
        } catch (error) {
            console.error('Error exporting test results:', error);
            this.showError('Failed to export test results: ' + error.message);
        } finally {
            // Reset button state
            this.exportExcelBtn.disabled = false;
            this.exportExcelBtn.innerHTML = '<i class="fas fa-file-excel me-2"></i>Export to Excel';
        }
    }

    async deleteTestResult(resultId) {
        if (!confirm('Are you sure you want to delete this test result? This action cannot be undone.')) {
            return;
        }

        try {
            // Show loading state in the container
            this.testResultsContainer.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border text-danger" role="status">
                        <span class="visually-hidden">Deleting...</span>
                    </div>
                    <div class="mt-2">Deleting test result...</div>
                </div>
            `;

            const response = await fetch(`/api/test-results/${resultId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showSuccess('Test result deleted successfully!');
            } else {
                const error = await response.json().catch(() => ({ message: 'Unknown error occurred' }));
                throw new Error(error.message || 'Failed to delete test result');
            }
        } catch (error) {
            console.error('Error deleting test result:', error);
            this.showError('Failed to delete test result: ' + error.message);
        } finally {
            // Always refresh the test results, regardless of success or failure
            try {
                await this.loadTestResults();
            } catch (refreshError) {
                console.error('Error refreshing test results:', refreshError);
                // If refresh fails, show a fallback message
                this.testResultsContainer.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Unable to refresh test results. Please close and reopen this dialog.
                        <button class="btn btn-sm btn-outline-primary ms-2" onclick="translator.loadTestResults()">
                            <i class="fas fa-sync me-1"></i>Try Again
                        </button>
                    </div>
                `;
            }
        }
    }

    showSuccess(message) {
        this.showAlert(message, 'success');
    }

    showError(message) {
        this.showAlert(message, 'danger');
    }

    showAlert(message, type = 'info') {
        // Create alert element
        const alertElement = document.createElement('div');
        alertElement.className = `alert alert-${type} alert-dismissible fade show`;
        // Snackbar at the bottom centre, clear of the top navigation
        alertElement.style.cssText = 'position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 9999; width: max-content; min-width: min(300px, calc(100vw - 32px)); max-width: calc(100vw - 32px);';
        alertElement.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas ${this.getAlertIcon(type)} me-2"></i>
                ${escapeHtml(message)}
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

        // Add to page
        document.body.appendChild(alertElement);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (alertElement.parentNode) {
                alertElement.remove();
            }
        }, 5000);
    }

    getAlertIcon(type) {
        const icons = {
            'success': 'fa-check-circle',
            'danger': 'fa-exclamation-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle'
        };
        return icons[type] || icons['info'];
    }
}

// Global translator instance
let translator;

// Initialize the translator when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    translator = new DNTranslator();
});

// Warn before leaving only if a quality assessment was filled in but not saved.
// Translations themselves are quick to redo, so they do not trigger the warning.
// "Tested By" is ignored because it is kept after a successful save.
window.addEventListener('beforeunload', (e) => {
    const hasUnsavedAssessment = ['outcome', 'accuracy', 'observation']
        .some((id) => document.getElementById(id)?.value?.trim());

    if (hasUnsavedAssessment) {
        e.preventDefault();
        e.returnValue = 'You have an unsaved test result. Are you sure you want to leave?';
    }
});

// Handle online/offline status
// Reuse the page's translator; constructing another would bind every listener twice
window.addEventListener('online', () => {
    translator?.showAlert('Connection restored. You can now translate text.', 'success');
});

window.addEventListener('offline', () => {
    translator?.showAlert('You are currently offline. Translation services are unavailable.', 'warning');
});