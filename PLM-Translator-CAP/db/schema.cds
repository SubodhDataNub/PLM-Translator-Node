namespace plm.translator;

using { cuid, managed } from '@sap/cds/common';

entity TestResults {
  key ID              : Integer;
      outcome         : String(50) not null;
      accuracy        : Double;
      observation     : LargeString;
      testedBy        : String(100);
      textToTranslate : LargeString;
      translatedText  : LargeString;
      terminologyNote : String(1000);
      sourceLanguage  : String(20);
      targetLanguage  : String(100);
      sessionId       : String(100);
      createdAt       : Timestamp @cds.on.insert: $now;
      createdBy       : String(255) @cds.on.insert: $user;
      outcomeInfo     : Association to Outcomes on outcomeInfo.code = outcome;
}

entity ActivityLog : cuid {
  createdAt    : Timestamp @cds.on.insert: $now;
  userName     : String(255);
  activity     : String(40);
  details      : String(1000);
  language     : String(100);
  itemCount    : Integer;
  sessionId    : String(100);
  activityInfo : Association to ActivityTypes on activityInfo.code = activity;
  results      : Association to many TestResults on results.sessionId = sessionId;
}

entity MassTranslations : cuid, managed {
  fileName         : String(255);
  mimeType         : String(100);
  file             : LargeBinary @Core.MediaType: mimeType @Core.ContentDisposition.Filename: fileName;
  testedBy         : String(100);
  status           : String(20) default 'New';
  totalRows        : Integer;
  textColumn       : String(255);
  sessionId        : String(100);
  successful       : Integer;
  failed           : Integer;
  successRate      : Double;
  labelTypes       : String(200);
  resultFileName   : String(255);
  resultFile       : LargeBinary @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                                 @Core.ContentDisposition.Filename: resultFileName;
  templateFileName : String(255);
  templateFile     : LargeBinary @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                                 @Core.ContentDisposition.Filename: templateFileName;
  languages        : Composition of many MassTranslationLanguages on languages.parent = $self;
  results          : Association to many TestResults on results.sessionId = sessionId;
}

entity MassTranslationLanguages : cuid {
  parent       : Association to MassTranslations;
  language     : String(20);
  languageInfo : Association to Languages on languageInfo.code = language;
}

entity Languages {
  key code  : String(20);
      name  : String(100);
      label : String(130);
}

entity Outcomes {
  key code        : String(50);
      name        : String(50);
      criticality : Integer;
}

entity ActivityTypes {
  key code : String(40);
      name : String(60);
}
