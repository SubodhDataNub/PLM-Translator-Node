namespace plm.translator;

/**
 * Translation test results: one row per reviewed single translation, and one row per
 * text and target language of a mass translation.
 * Same columns as the test_results table of the Node.js version.
 */
entity TestResults {
  key ID              : Integer;
      outcome         : String(50) not null; // Success / Partial / Failure
      accuracy        : Double;              // Percentage accuracy (0 for mass translations)
      observation     : LargeString;         // Reviewer observations, or the mass translation row
      testedBy        : String(100);         // Who tested it
      textToTranslate : LargeString;         // Original text
      translatedText  : LargeString;         // Translated text ('ERROR: ...' for failed mass rows)
      sourceLanguage  : String(100);         // Source language code
      targetLanguage  : String(100);         // Target language as 'code-Name', e.g. 'fr-French'
      sessionId       : String(100);         // Groups the rows of one mass translation
      createdAt       : Timestamp @cds.on.insert: $now;
}
