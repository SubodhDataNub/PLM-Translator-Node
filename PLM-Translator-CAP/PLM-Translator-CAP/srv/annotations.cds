using TranslatorService from './translator-service';

// Fiori elements preview of the test results (index page → TestResults → Fiori preview)
annotate TranslatorService.TestResults with @(
  UI.HeaderInfo          : {
    TypeName       : 'Test Result',
    TypeNamePlural : 'Test Results',
    Title          : { Value: textToTranslate },
    Description    : { Value: targetLanguage }
  },
  UI.SelectionFields     : [ outcome, targetLanguage, testedBy, sessionId ],
  UI.LineItem            : [
    { Value: ID },
    { Value: outcome },
    { Value: accuracy },
    { Value: targetLanguage },
    { Value: textToTranslate },
    { Value: translatedText },
    { Value: testedBy },
    { Value: createdAt }
  ],
  UI.Facets              : [{ $Type: 'UI.ReferenceFacet', Label: 'Details', Target: '@UI.FieldGroup#Details' }],
  UI.FieldGroup #Details : { Data: [
    { Value: outcome },
    { Value: accuracy },
    { Value: observation },
    { Value: testedBy },
    { Value: textToTranslate },
    { Value: translatedText },
    { Value: sourceLanguage },
    { Value: targetLanguage },
    { Value: sessionId },
    { Value: createdAt }
  ]}
) {
  ID              @title: 'ID';
  outcome         @title: 'Outcome';
  accuracy        @title: 'Accuracy (%)';
  observation     @title: 'Observation';
  testedBy        @title: 'Tested By';
  textToTranslate @title: 'Text to Translate';
  translatedText  @title: 'Translated Text';
  sourceLanguage  @title: 'Source Language';
  targetLanguage  @title: 'Target Language';
  sessionId       @title: 'Session ID';
  createdAt       @title: 'Date Created';
};
