using plm.translator as db from '../db/schema';

@path: '/odata/v4/translator'
@requires: ['User', 'Admin']
@cds.server.body_parser.limit: '300mb'
service TranslatorService {

  @odata.draft.enabled
  @cds.search: { observation, testedBy, textToTranslate, translatedText }
  @restrict: [
    { grant: '*', to: 'Admin' },
    { grant: 'READ', to: 'User', where: 'createdBy = $user' },
    { grant: ['CREATE', 'translateText'], to: 'User' }
  ]
  entity TestResults as projection on db.TestResults {
    *,
    createdBy @readonly
  } actions {
    @Core.OperationAvailable: { $edmJson: { $Not: { $Path: 'in/IsActiveEntity' } } }
    @Common.SideEffects: { TargetProperties: ['in/translatedText', 'in/sourceLanguage', 'in/terminologyNote'] }
    action translateText();
  };

  @odata.draft.enabled
  @cds.search: { fileName, testedBy, sessionId }
  @restrict: [
    { grant: '*', to: 'Admin' },
    { grant: ['READ', 'UPDATE', 'DELETE', 'start'], to: 'User', where: 'createdBy = $user' },
    { grant: 'CREATE', to: 'User' }
  ]
  entity MassTranslations as projection on db.MassTranslations {
    *,
    virtual null as estimatedTime : String(100)
  } actions {
    @Core.OperationAvailable: { $edmJson: { $And: [
      { $Path: 'in/IsActiveEntity' },
      { $Eq: [ { $Path: 'in/status' }, 'New' ] }
    ] } }
    @Common.SideEffects: {
      TargetProperties: ['in/*'],
      TargetEntities  : ['in/results']
    }
    action start();
  };

  entity MassTranslationLanguages as projection on db.MassTranslationLanguages;

  @readonly
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  @cds.search: { userName, activity, details }
  entity ActivityLog as projection on db.ActivityLog;

  @readonly
  entity Languages as projection on db.Languages;

  @readonly
  entity Outcomes as projection on db.Outcomes;

  @readonly
  entity ActivityTypes as projection on db.ActivityTypes;
}
