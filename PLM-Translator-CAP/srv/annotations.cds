using TranslatorService from './translator-service';

annotate TranslatorService.TestResults with @(
  UI.UpdateHidden        : true,
  UI.DeleteHidden        : true,
  UI.HeaderInfo          : {
    TypeName       : 'Test Result',
    TypeNamePlural : 'Test Results',
    Title          : { Value: textToTranslate },
    Description    : { Value: targetLanguage }
  },
  UI.SelectionFields     : [ outcome, targetLanguage, testedBy, createdAt, sessionId ],
  UI.LineItem            : [
    { Value: outcome, Criticality: outcomeInfo.criticality },
    { Value: accuracy },
    { Value: targetLanguage },
    { Value: textToTranslate },
    { Value: translatedText },
    { Value: testedBy },
    { Value: createdAt }
  ],
  UI.PresentationVariant : {
    Visualizations : [ '@UI.LineItem' ],
    SortOrder      : [ { Property: createdAt, Descending: true } ]
  },
  UI.SelectionPresentationVariant #All     : {
    Text                : 'All',
    SelectionVariant    : { SelectOptions: [] },
    PresentationVariant : { Visualizations: [ '@UI.LineItem' ], SortOrder: [ { Property: createdAt, Descending: true } ] }
  },
  UI.SelectionPresentationVariant #Success : {
    Text                : 'Successful',
    SelectionVariant    : { SelectOptions: [{
      PropertyName : outcome,
      Ranges       : [{ Sign: #I, Option: #EQ, Low: 'Success' }]
    }] },
    PresentationVariant : { Visualizations: [ '@UI.LineItem' ], SortOrder: [ { Property: createdAt, Descending: true } ] }
  },
  UI.SelectionPresentationVariant #Partial : {
    Text                : 'Partial',
    SelectionVariant    : { SelectOptions: [{
      PropertyName : outcome,
      Ranges       : [{ Sign: #I, Option: #EQ, Low: 'Partial' }]
    }] },
    PresentationVariant : { Visualizations: [ '@UI.LineItem' ], SortOrder: [ { Property: createdAt, Descending: true } ] }
  },
  UI.SelectionPresentationVariant #Failed  : {
    Text                : 'Failed',
    SelectionVariant    : { SelectOptions: [{
      PropertyName : outcome,
      Ranges       : [
        { Sign: #I, Option: #EQ, Low: 'Failure' },
        { Sign: #I, Option: #EQ, Low: 'Failed' }
      ]
    }] },
    PresentationVariant : { Visualizations: [ '@UI.LineItem' ], SortOrder: [ { Property: createdAt, Descending: true } ] }
  },
  UI.Facets              : [
    { $Type: 'UI.ReferenceFacet', ID: 'Translation', Label: 'Translation', Target: '@UI.FieldGroup#Translation' },
    { $Type: 'UI.ReferenceFacet', ID: 'Review', Label: 'Review', Target: '@UI.FieldGroup#Review' },
    { $Type: 'UI.ReferenceFacet', ID: 'Admin', Label: 'Record', Target: '@UI.FieldGroup#Record' }
  ],
  UI.FieldGroup #Translation : { Data: [
    { Value: textToTranslate },
    { Value: targetLanguage },
    {
      $Type        : 'UI.DataFieldForAction',
      Action       : 'TranslatorService.translateText',
      Label        : 'Translate',
      @UI.Hidden: { $edmJson: { $Path: 'IsActiveEntity' } }
    },
    { Value: translatedText },
    { Value: sourceLanguage },
    { Value: terminologyNote }
  ]},
  UI.FieldGroup #Review  : { Data: [
    { Value: outcome, Criticality: outcomeInfo.criticality },
    { Value: accuracy },
    { Value: observation },
    { Value: testedBy }
  ]},
  UI.FieldGroup #Record  : { Data: [
    { Value: sessionId },
    { Value: createdAt },
    { Value: createdBy },
    { Value: modifiedAt },
    { Value: modifiedBy }
  ]}
) {
  ID              @UI.Hidden;
  outcome         @title: 'Outcome' @mandatory
                  @Common.Text: outcomeInfo.name @Common.TextArrangement: #TextOnly
                  @Common.ValueListWithFixedValues
                  @Common.ValueList: {
                    CollectionPath : 'Outcomes',
                    Parameters     : [
                      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: outcome, ValueListProperty: 'code' },
                      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
                    ]
                  };
  accuracy        @title: 'Accuracy (%)' @assert.range: [0, 100];
  observation     @title: 'Observation' @UI.MultiLineText;
  testedBy        @title: 'Tested By';
  textToTranslate @title: 'Text to Translate' @mandatory @UI.MultiLineText;
  translatedText  @title: 'Translated Text' @readonly @UI.MultiLineText;
  terminologyNote @title: 'Terminology' @readonly;
  sourceLanguage  @title: 'Source Language' @readonly;
  targetLanguage  @title: 'Target Language' @mandatory
                  @Common.ValueList: {
                    CollectionPath : 'Languages',
                    Parameters     : [
                      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: targetLanguage, ValueListProperty: 'label' },
                      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
                      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' }
                    ]
                  };
  sessionId       @title: 'Session ID' @readonly;
  createdAt       @title: 'Date Created';
  createdBy       @title: 'Created By';
  modifiedAt      @title: 'Last Changed';
  modifiedBy      @title: 'Last Changed By';
};

annotate TranslatorService.MassTranslations with @(
  UI.UpdateHidden       : editLocked,
  UI.HeaderInfo         : {
    TypeName       : 'Mass Translation',
    TypeNamePlural : 'Mass Translations',
    Title          : { Value: fileName },
    Description    : { Value: status }
  },
  UI.SelectionFields     : [ status, testedBy, createdAt ],
  UI.LineItem            : [
    { Value: fileName, @HTML5.CssDefaults: { width: 'auto' }, @UI.Importance: #High },
    { Value: status, @HTML5.CssDefaults: { width: '7rem' }, @UI.Importance: #High },
    { Value: totalRows, @HTML5.CssDefaults: { width: '5rem' } },
    { Value: successful, @HTML5.CssDefaults: { width: '6.5rem' } },
    { Value: failed, @HTML5.CssDefaults: { width: '5rem' } },
    { Value: successRate, @HTML5.CssDefaults: { width: '8.5rem' } },
    { Value: testedBy, @HTML5.CssDefaults: { width: '13rem' } },
    { Value: createdAt, @HTML5.CssDefaults: { width: '11rem' } }
  ],
  UI.PresentationVariant : {
    Visualizations : [ '@UI.LineItem' ],
    SortOrder      : [ { Property: createdAt, Descending: true } ]
  },
  UI.Identification      : [
    { $Type: 'UI.DataFieldForAction', Action: 'TranslatorService.start', Label: 'Start Translation' }
  ],
  UI.HeaderFacets        : [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#successRate' }
  ],
  UI.DataPoint #successRate : { Value: successRate, Title: 'Success Rate (%)' },
  UI.Facets              : [
    { $Type: 'UI.ReferenceFacet', ID: 'Setup', Label: 'Setup', Target: '@UI.FieldGroup#Setup' },
    { $Type: 'UI.ReferenceFacet', ID: 'Outcome', Label: 'Outcome', Target: '@UI.FieldGroup#Outcome' },
    { $Type: 'UI.ReferenceFacet', ID: 'Translations', Label: 'Translations', Target: 'results/@UI.LineItem' }
  ],
  UI.FieldGroup #Setup   : { Data: [
    { Value: file },
    { Value: languages.language, Label: 'Target Languages' },
    { Value: testedBy },
    { Value: totalRows },
    { Value: textColumn },
    { Value: estimatedTime },
    { Value: templateFile }
  ]},
  UI.FieldGroup #Outcome : { Data: [
    { Value: status },
    { Value: successful },
    { Value: failed },
    { Value: successRate },
    { Value: labelTypes },
    { Value: resultFile },
    { Value: sessionId }
  ]}
) {
  fileName       @title: 'File Name' @readonly;
  mimeType       @readonly;
  file           @title: 'Excel File' @Core.AcceptableMediaTypes: [
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                   'application/vnd.ms-excel'
                 ];
  testedBy       @title: 'Tested By';
  status         @title: 'Status' @readonly;
  totalRows      @title: 'Rows' @readonly;
  textColumn     @title: 'Text Column' @readonly;
  estimatedTime  @title: 'Estimated Time';
  editLocked     @UI.Hidden;
  sessionId      @title: 'Session ID' @readonly;
  successful     @title: 'Successful' @readonly;
  failed         @title: 'Failed' @readonly;
  successRate    @title: 'Success Rate (%)' @readonly;
  labelTypes     @title: 'Label Types' @readonly;
  resultFileName @readonly;
  resultFile     @title: 'Results File' @readonly;
  templateFileName @readonly;
  templateFile   @title: 'Template' @readonly;
  createdAt      @title: 'Created On';
  createdBy      @title: 'Created By';
};

annotate TranslatorService.MassTranslationLanguages with {
  language @title: 'Language'
           @Common.Text: languageInfo.name @Common.TextArrangement: #TextFirst
           @Common.ValueList: {
             CollectionPath : 'Languages',
             Parameters     : [
               { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: language, ValueListProperty: 'code' },
               { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
             ]
           };
};

annotate TranslatorService.ActivityLog with @(
  UI.HeaderInfo          : {
    TypeName       : 'Activity',
    TypeNamePlural : 'User Activity',
    Title          : { Value: activity }
  },
  UI.SelectionFields     : [ createdBy, activity, createdAt ],
  UI.LineItem            : [
    { Value: createdAt },
    { Value: createdBy },
    { Value: activity },
    { Value: details },
    { Value: language },
    { Value: itemCount }
  ],
  UI.PresentationVariant : {
    Visualizations : [ '@UI.LineItem' ],
    SortOrder      : [ { Property: createdAt, Descending: true } ]
  },
  UI.HeaderFacets        : [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#Who' }
  ],
  UI.FieldGroup #Who     : { Data: [
    { Value: createdBy },
    { Value: createdAt }
  ]},
  UI.Facets              : [
    { $Type: 'UI.ReferenceFacet', ID: 'Details', Label: 'Details', Target: '@UI.FieldGroup#Details' },
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'Translations',
      Label        : 'Translations',
      Target       : 'results/@UI.LineItem',
      @UI.Hidden: { $edmJson: { $Eq: [ { $Path: 'sessionId' }, { $Null: null } ] } }
    }
  ],
  UI.FieldGroup #Details : { Data: [
    { Value: activity },
    { Value: details },
    { Value: language },
    { Value: itemCount },
    { Value: sessionId }
  ]}
) {
  ID        @UI.Hidden;
  createdAt @title: 'Time';
  createdBy @title: 'User';
  activity  @title: 'Activity'
            @Common.Text: activityInfo.name @Common.TextArrangement: #TextOnly
            @Common.ValueListWithFixedValues
            @Common.ValueList: {
              CollectionPath : 'ActivityTypes',
              Parameters     : [
                { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: activity, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
              ]
            };
  details   @title: 'Details';
  language  @title: 'Language';
  itemCount @title: 'Items';
  sessionId @title: 'Session ID';
};

annotate TranslatorService.Languages with {
  code  @title: 'Code';
  name  @title: 'Language';
  label @title: 'Language';
};

annotate TranslatorService.Outcomes with {
  code @title: 'Outcome' @Common.Text: name @Common.TextArrangement: #TextOnly;
  name @title: 'Outcome';
};

annotate TranslatorService.ActivityTypes with {
  code @title: 'Activity' @Common.Text: name @Common.TextArrangement: #TextOnly;
  name @title: 'Activity';
};

annotate TranslatorService.TestResults with @Common.SideEffects #Outcome: {
  SourceProperties : [ outcome ],
  TargetProperties : [ 'accuracy' ]
};

annotate TranslatorService.MassTranslations with @Common.SideEffects #File: {
  SourceProperties : [ file ],
  TargetProperties : [ 'fileName', 'totalRows', 'textColumn', 'estimatedTime' ]
};

annotate TranslatorService.MassTranslations with @Common.SideEffects #Languages: {
  SourceEntities   : [ languages ],
  TargetProperties : [ 'estimatedTime' ]
};
