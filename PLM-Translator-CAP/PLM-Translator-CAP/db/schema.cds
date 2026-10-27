namespace plm.translator;

using { cuid } from '@sap/cds/common';

entity TestResults {
  key ID              : Integer;
      outcome         : String(50) not null;
      accuracy        : Double;
      observation     : LargeString;
      testedBy        : String(100);
      textToTranslate : LargeString;
      translatedText  : LargeString;
      sourceLanguage  : String(100);
      targetLanguage  : String(100);
      sessionId       : String(100);
      createdAt       : Timestamp @cds.on.insert: $now;
      createdBy       : String(255) @cds.on.insert: $user;
}

entity ActivityLog : cuid {
  createdAt : Timestamp @cds.on.insert: $now;
  userName  : String(255);
  activity  : String(40);
  details   : String(1000);
  language  : String(100);
  itemCount : Integer;
  sessionId : String(100);
}
