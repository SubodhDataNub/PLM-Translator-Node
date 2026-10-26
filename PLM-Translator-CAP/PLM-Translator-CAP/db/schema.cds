namespace plm.translator;

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
}
