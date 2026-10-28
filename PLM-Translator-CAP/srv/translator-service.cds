using plm.translator as db from '../db/schema';

@path: '/odata/v4/translator'
@requires: ['User', 'Admin']
@cds.server.body_parser.limit: '300mb'
service TranslatorService {

  @cds.search: { observation, testedBy, textToTranslate, translatedText }
  @restrict: [
    { grant: '*', to: 'Admin' },
    { grant: 'READ', to: 'User', where: 'createdBy = $user' },
    { grant: 'CREATE', to: 'User' }
  ]
  entity TestResults as projection on db.TestResults {
    *,
    createdBy @readonly
  };

  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  @cds.search: { userName, activity, details }
  entity ActivityLog as projection on db.ActivityLog;

  type Language {
    code : String;
    name : String;
  }

  type TerminologySummary {
    official : many String;
    kept     : many String;
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
    isAdmin  : Boolean;
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
    sampleData      : LargeString;
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
    content  : LargeString;
  }

  function languages() returns many Language;

  action   translate(text : String, targetLanguage : String, labelType : String) returns TranslationResult;

  function userInfo() returns UserInfo;

  function resultStatistics(outcome : String, language : String, search : String) returns Statistics;

  function resultLanguages() returns many String;

  @requires: 'Admin'
  function activityUsers() returns many String;

  function exportTestResults(outcome : String, language : String, search : String) returns ExcelFile;

  action   validateFile(fileName : String, content : LargeString, targetLanguages : many String) returns FileValidation;

  action   estimateProcessingTime(recordCount : Integer, targetLanguages : many String) returns ProcessingEstimate;

  action   massTranslate(fileName : String, content : LargeString, targetLanguages : many String,
                         testedBy : String, labelType : String) returns MassTranslationResult;

  function downloadSessionResults(sessionId : String) returns ExcelFile;

  function downloadTemplate() returns ExcelFile;
}
