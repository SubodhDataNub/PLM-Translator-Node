# DN Translator (SAP CAP)

SAP Cloud Application Programming Model (CAP, Node.js) version of DN Translator. It covers the same work as `PLM-Translator-Node`, as three SAP Fiori elements apps, and translates with the **same Google Cloud Translation client**. The difference is the backend: the Express routes and Knex are replaced by a CDS data model and an OData V4 service, and data is stored in a local SQLite database.

| Area | Node.js version | CAP version |
|---|---|---|
| Server | Express 5 (`server.js`) | CAP `cds-serve` + `server.js` hooks |
| Data model | Knex table `test_results` | CDS entity `plm.translator.TestResults` (`db/schema.cds`) |
| API | REST under `/api/*` | OData V4 under `/odata/v4/translator` (`srv/translator-service.cds`) |
| Database | SQLite / Azure SQL / PostgreSQL | SQLite (`data/plm_translator.db`) via `@cap-js/sqlite` |
| Pages | Nunjucks templates | Three SAP Fiori elements apps generated from CDS annotations (`app/*`, `srv/annotations.cds`) |
| Translation | `services/translator.js` | `srv/lib/translator.js`: the same code, unchanged |
| Terminology | `services/terminology.js` + `Train_Data/` | `srv/lib/terminology.js` + `Train_Data/`: the same code and data |

## Quick start

```bash
cd PLM-Translator-CAP
npm install
cp .env.example .env      # then fill in your Google credentials (see below)
npm start                 # http://localhost:4004
```

`npm run watch` (`cds watch`) restarts the server when files change. Node.js 20 or newer is required. Node 22.5+ uses the built-in `node:sqlite` driver, so no native build is needed.

The SQLite database file `data/plm_translator.db` and its tables are created on first start. Existing data is never dropped. To start again with an empty database, stop the server and delete the file.

`http://localhost:4004/` opens a local SAP Fiori launchpad (`app/launchpage.html`) with three tiles:

- **Translations** (`app/translations`): a list report of all test results with filters, tabs per outcome and Excel export. **Create** opens a new test result: enter the text, pick the target language, press **Translate**, fill in the review (outcome, accuracy, observation) and press **Create** to save it.
- **Mass Translation** (`app/masstranslation`): each run is a record. **Create**, upload the Excel file (the **Template** link gives a sample file), add the target languages and save. Then press **Start Translation**. The page shows the statistics, a downloadable results file and every translated row; click a row to open it. A completed run can no longer be edited.
- **User Activity** (`app/activity`, administrators only): what each user did and when. Click an entry for its details and the translations it produced, then a translation to open it.

All three are standard SAP Fiori elements (OData V4) apps. Their screens come from the annotations in `srv/annotations.cds`; there are no custom views, controllers or CSS. They load SAPUI5 1.148 from the SAP CDN at `ui5.sap.com`, so the browser needs internet access, and there is no UI build step when running locally. On SAP BTP each app is deployed to the HTML5 repository and added to SAP Build Work Zone as its own tile, which also provides the theme and user settings.

## Google Cloud Translation

Configuration works exactly as in the Node.js version, with the same environment variables in `.env`. See `PLM-Translator-Node/README.md` for how to create the credentials.

- **Option A (recommended): Advanced (v3).** Set `GOOGLE_CLOUD_PROJECT_ID`, plus `GOOGLE_APPLICATION_CREDENTIALS` (a key file path) or `GOOGLE_CREDENTIALS_JSON`, or use your `gcloud auth application-default login`. This option uses the Translation LLM by default (`GOOGLE_TRANSLATE_MODEL=general/translation-llm`). Languages the LLM does not support are translated with the standard model.
- **Option B: Basic (v2).** Set `GOOGLE_TRANSLATE_API_KEY`. This option uses the standard model only.

At startup the server logs which option is active:

```
Translation provider: Google Cloud Translation Advanced (v3) - project …, location …, model general/translation-llm
```

Batching, rate limiting and retries also behave as in the Node.js version, controlled by `TRANSLATE_BATCH_SIZE`, `TRANSLATE_MAX_CHARS_PER_REQUEST`, `TRANSLATE_REQUEST_DELAY_MS` and `TRANSLATE_MAX_RETRIES`. So does label terminology: official wording and protected terms from `Train_Data/`, with the label type detected per text.

If the credentials are not allowed to list languages, the built-in language list is used. Translation still works.

## OData service

Base path: `/odata/v4/translator`. The Fiori apps use these entities; any OData V4 client can too.

| Entity | Notes |
|---|---|
| `TestResults` | Draft-enabled. `translateText` (bound action on a draft) translates `textToTranslate` into `targetLanguage`. Saving validates outcome and accuracy and stores the language as `code-Name`. Users see their own results, administrators see all. |
| `MassTranslations` | Draft-enabled. `file` is the uploaded Excel file (media property), `languages` the target languages. `start` (bound action) translates every row and fills the statistics and `resultFile`. |
| `ActivityLog` | Read-only, administrators only. |
| `Languages`, `Outcomes`, `ActivityTypes` | Value lists. Languages come from Google at startup. |

Example:

```bash
curl "localhost:4004/odata/v4/translator/TestResults?\$filter=outcome%20eq%20'Success'&\$orderby=ID%20desc&\$top=10&\$count=true"
```

Uploads are limited to `MAX_UPLOAD_MB` (default 200).

## Project structure

```
package.json                 Dependencies, scripts and CAP config (cds.requires.db → SQLite)
server.js                    CAP server hooks: create DB tables, page redirects, 30-min request timeout
db/schema.cds                Data model: test results, mass translations, activity log, value lists
srv/translator-service.cds   OData service: draft-enabled entities and bound actions
srv/translator-service.js    Service handlers
srv/annotations.cds          Fiori elements annotations: every list, page, field and value help
srv/lib/translator.js        Google Cloud Translation client (from the Node.js version)
srv/lib/terminology.js       Label terminology (from the Node.js version)
srv/lib/excel.js             Excel read/write helpers (from the Node.js version)
srv/lib/mass-translation.js  Mass translation, validation, estimates, result workbooks
srv/lib/code-lists.js        Fills the language, outcome and activity value lists at startup
srv/lib/utils.js             Helpers
srv/lib/config.js            Google / batching settings from .env
app/launchpage.html          Local Fiori launchpad with the three tiles
app/translations/            Fiori elements app: test results and single translation
app/masstranslation/         Fiori elements app: mass translation runs
app/activity/                Fiori elements app: user activity
Train_Data/                  Terminology database
```

## Differences from the Node.js version

- **Database.** Only SQLite is configured. To use another database, change `cds.requires.db` in `package.json`, for example to `@cap-js/postgres` or `@cap-js/hana`.
- **IDs.** Test result IDs are sequential integers, assigned by the service in a single server process.
- **Mass translation.** The Node.js version has unused background and chunked processing code (`/api/translation-progress`); it is not ported. **Start Translation** runs in the request, as the Node.js page already did.
- **Port.** The app runs on 4004 (CAP's default), so it can run next to the Node.js app on 5000.
