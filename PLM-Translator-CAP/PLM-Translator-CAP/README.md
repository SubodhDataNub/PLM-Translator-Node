# DN Translator (SAP CAP)

SAP Cloud Application Programming Model (CAP, Node.js) version of DN Translator. It has the same three pages as `PLM-Translator-Node` and translates with the **same Google Cloud Translation client**. The difference is the backend: the Express routes and Knex are replaced by a CDS data model and an OData V4 service, and data is stored in a local SQLite database.

| Area | Node.js version | CAP version |
|---|---|---|
| Server | Express 5 (`server.js`) | CAP `cds-serve` + `server.js` hooks |
| Data model | Knex table `test_results` | CDS entity `plm.translator.TestResults` (`db/schema.cds`) |
| API | REST under `/api/*` | OData V4 under `/odata/v4/translator` (`srv/translator-service.cds`) |
| Database | SQLite / Azure SQL / PostgreSQL | SQLite (`data/plm_translator.db`) via `@cap-js/sqlite` |
| Pages | Nunjucks templates | Static HTML in `app/` that calls the OData service (`app/static/js/api.js`) |
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

The pages are:

- `http://localhost:4004/`: single translation and review
- `http://localhost:4004/mass-translation.html`: Excel mass translation. `/mass-translation` redirects here.
- `http://localhost:4004/test-results.html`: saved results with filters and Excel export. `/test-results` redirects here.
- `http://localhost:4004/$fiori-preview/TranslatorService/TestResults#preview-app`: a Fiori elements list of the test results, generated from `srv/annotations.cds`

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

Base path: `/odata/v4/translator`

| Operation | Replaces (Node.js) | Notes |
|---|---|---|
| `TestResults` (GET, POST, DELETE, `$filter`, `$orderby`, `$top`, `$skip`, `$count`) | `/api/test-results`, `/api/save-test-results`, `DELETE /api/test-results/:id` | POST validates outcome and accuracy, maps `Failed` → `Failure`, stores the language as `code-Name` |
| `languages()` | `GET /api/languages` | `[{code, name}]` |
| `translate(text, targetLanguage, labelType)` | `POST /api/translate` | `labelType`: `auto` (default), `general`, `food`, `cosmetic`, `off` |
| `userInfo()` | `GET /api/azure-user` | |
| `resultStatistics(outcome, language, search)` | statistics on the test results page | |
| `resultLanguages()` | language filter on the test results page | |
| `exportTestResults(outcome, language, search)` | `GET /api/export-test-results` | returns `{fileName, mimeType, content}` (base64 .xlsx) |
| `validateFile(fileName, content, targetLanguages)` | `POST /api/validate-large-file` | `content`: base64 .xlsx |
| `estimateProcessingTime(recordCount, targetLanguages)` | `POST /api/estimate-processing-time` | |
| `massTranslate(fileName, content, targetLanguages, testedBy, labelType)` | `POST /api/mass-translate` | `content`: base64 .xlsx; returns `sessionId` and statistics |
| `downloadSessionResults(sessionId)` | `POST /api/download-translation-results` | one row per text, one column per language |
| `downloadTemplate()` | `GET /api/download-template` | |

Examples:

```bash
curl -X POST localhost:4004/odata/v4/translator/translate \
     -H "Content-Type: application/json" \
     -d '{"text":"Keep out of reach of children.","targetLanguage":"fr"}'

curl "localhost:4004/odata/v4/translator/TestResults?\$filter=outcome%20eq%20'Success'&\$orderby=ID%20desc&\$top=10&\$count=true"
```

Excel files are sent and returned as base64 inside JSON, so every operation stays a plain OData action or function. The service accepts request bodies up to 300 MB (`@cds.server.body_parser.limit`); uploads are limited to `MAX_UPLOAD_MB` (default 200).

## Project structure

```
package.json                 Dependencies, scripts and CAP config (cds.requires.db → SQLite)
server.js                    CAP server hooks: create DB tables, page redirects, 30-min request timeout
db/schema.cds                Data model: TestResults
srv/translator-service.cds   OData service: entity, types, actions and functions
srv/translator-service.js    Service handlers
srv/annotations.cds          Fiori elements annotations for TestResults
srv/lib/translator.js        Google Cloud Translation client (from the Node.js version)
srv/lib/terminology.js       Label terminology (from the Node.js version)
srv/lib/excel.js             Excel read/write helpers (from the Node.js version)
srv/lib/mass-translation.js  Mass translation, validation, estimates, result workbooks
srv/lib/utils.js             Helpers
srv/lib/config.js            Google / batching settings from .env
app/                         Pages, CSS, JS and images (served at /)
Train_Data/                  Terminology database
```

## Differences from the Node.js version

- **Database.** Only SQLite is configured. To use another database, change `cds.requires.db` in `package.json`, for example to `@cap-js/postgres` or `@cap-js/hana`.
- **IDs.** Test result IDs are sequential integers, assigned by the service in a single server process.
- **Mass translation.** The Node.js version has unused background and chunked processing code (`/api/translation-progress`); it is not ported. Mass translation runs in the request, as the Node.js page already did.
- **Port.** The app runs on 4004 (CAP's default), so it can run next to the Node.js app on 5000.
