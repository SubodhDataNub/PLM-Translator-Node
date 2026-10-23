using plm.translator as db from '../db/schema';

/**
 * DN Translator service (OData V4).
 * Translates label text with the Google Cloud Translation API and stores test results.
 * Excel files travel base64-encoded, so the body limit covers large uploads.
 */
@path: '/odata/v4/translator'
@cds.server.body_parser.limit: '300mb'
service TranslatorService {

  @cds.search: { observation, testedBy, textToTranslate, translatedText }
  entity TestResults as projection on db.TestResults;

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  type Language {
    code : String;
    name : String;
  }

  /** Terms applied by the label terminology (see srv/lib/terminology.js) */
  type TerminologySummary {
    official : many String; // replaced by the official wording for the target language
    kept     : many String; // kept as written (codes, units, INCI names)
    skipped  : Boolean;
  }

  type TranslationResult {
    translatedText    : LargeString;
    sourceLanguage    : String;
    targetLanguage    : String;
    labelType         : String;
    labelTypeDetected : Boolean;
    terminology       : TerminologySummary;
  }

  type UserInfo {
    user     : String;
    username : String;
    computer : String;
  }

  type Statistics {
    total       : Integer;
    success     : Integer;
    partial     : Integer;
    failed      : Integer;
    successRate : Double;
    unfiltered  : Integer;
  }

  type ProcessingEstimate {
    estimatedMinutes : Double;
    estimatedHours   : Double;
    recordCount      : Integer;
    languageCount    : Integer;
    recommendation   : String;
  }

  type FileValidation {
    fileSizeMb      : Double;
    totalRows       : Integer;
    columns         : many String;
    textColumn      : String;
    sampleData      : LargeString; // JSON: first rows of the sheet
    recommendations : many String;
    timeEstimates   : ProcessingEstimate;
  }

  type LabelTypeCounts {
    general  : Integer;
    food     : Integer;
    cosmetic : Integer;
  }

  type MassTranslationResult {
    message         : String;
    sessionId       : String;
    labelType       : String;
    totalRows       : Integer;
    successful      : Integer;
    failed          : Integer;
    successRate     : Double;
    languagesCount  : Integer;
    targetLanguages : many String;
    labelTypes      : LabelTypeCounts;
  }

  type ExcelFile {
    fileName : String;
    mimeType : String;
    content  : LargeString; // base64
  }

  // ---------------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------------

  /** Target languages offered by Google (a built-in list until credentials are set) */
  function languages() returns many Language;

  /** Translate one text. labelType: auto (default), general, food, cosmetic or off */
  action   translate(text : String, targetLanguage : String, labelType : String) returns TranslationResult;

  /** Current user (OS account for local use) */
  function userInfo() returns UserInfo;

  // ---------------------------------------------------------------------------
  // Test results
  // ---------------------------------------------------------------------------

  /** Outcome counts for the test results page, with the same filters as the list */
  function resultStatistics(outcome : String, language : String, search : String) returns Statistics;

  /** Distinct stored target languages, for the language filter */
  function resultLanguages() returns many String;

  /** Test results as an Excel workbook */
  function exportTestResults(outcome : String, language : String, search : String) returns ExcelFile;

  // ---------------------------------------------------------------------------
  // Mass translation (Excel)
  // ---------------------------------------------------------------------------

  /** Check an uploaded workbook (base64) and estimate the processing time */
  action   validateFile(fileName : String, content : LargeString, targetLanguages : many String) returns FileValidation;

  action   estimateProcessingTime(recordCount : Integer, targetLanguages : many String) returns ProcessingEstimate;

  /** Translate every row of an uploaded workbook (base64) into each target language */
  action   massTranslate(fileName : String, content : LargeString, targetLanguages : many String,
                         testedBy : String, labelType : String) returns MassTranslationResult;

  /** Results of one mass translation: one row per text, one column per language */
  function downloadSessionResults(sessionId : String) returns ExcelFile;

  /** Workbook template to fill in for mass translation */
  function downloadTemplate() returns ExcelFile;
}
