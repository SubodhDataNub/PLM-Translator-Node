# DN Translator (Node.js)

Node.js/Express version of DN Translator. It has the same pages, API endpoints, and database schema as the Python/Flask version, but it translates with the **Google Cloud Translation API** instead of Azure AI Translator.

| Area | Python version | Node.js version |
|---|---|---|
| Web framework | Flask + Jinja2 | Express 5 + Nunjucks (Jinja2-compatible templates) |
| Database | SQLAlchemy (SQLite / Azure SQL) | Knex (SQLite / Azure SQL), same `test_results` table |
| Excel | pandas + openpyxl | ExcelJS |
| Translation | Azure AI Translator | Google Cloud Translation (Basic v2 or Advanced v3) |
| Server | gunicorn (`startup.sh`) | `npm start` (`server.js`) |

The Node app can use an existing database created by the Python app: the table layout and timestamp format are the same.

## Quick start

```bash
cd PLM-Translator-Node
npm install
cp .env.example .env      # then fill in your Google credentials (see below)
npm start                 # http://localhost:5000
```

Use `npm run dev` to restart automatically on file changes. Node.js 20 or newer is required.

If no database is configured, development mode uses SQLite at `data/plm_translator.db`.

## Setting up Google Cloud Translation

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick an existing one) and enable billing.
2. Enable the **Cloud Translation API** for the project.
3. Choose one of these authentication options. If both are configured, Option A is used.

### Option A (recommended): Cloud Translation Advanced (v3), with the Translation LLM

Advanced uses Google's **Translation LLM** model by default. In our comparison it was more accurate than the standard model. To use the standard model instead, set `GOOGLE_TRANSLATE_MODEL=general/nmt`.

- Go to **IAM & Admin → Service accounts**, create an account, and grant it the **Cloud Translation API User** role.
- Create a JSON key for the account.
- Set it in `.env`:

  ```
  GOOGLE_CLOUD_PROJECT_ID=your-project-id
  GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
  # or, instead of a file path (handy for Azure App Service settings):
  # GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}
  ```

- Optional settings:
  - `GOOGLE_CLOUD_LOCATION` (default `global`).
  - `GOOGLE_TRANSLATE_MODEL` (default `general/translation-llm`; `general/nmt` selects the standard model).

**If your organization blocks service account keys** (`iam.disableServiceAccountKeyCreation`), use your own Google login for local development instead. This is Application Default Credentials, and it needs no key file:

```
gcloud auth application-default login
gcloud auth application-default set-quota-project your-project-id
```

Then set only `GOOGLE_CLOUD_PROJECT_ID` and leave `GOOGLE_APPLICATION_CREDENTIALS` unset. This login only works on your own machine. A server deployment (e.g. Azure) needs a service account key or Workload Identity Federation.

**Translation LLM and languages:** the Translation LLM supports fewer languages than the standard model. The app still offers every language: when the LLM rejects one, the app translates that language with the standard model instead and logs a message.

### Option B: API key, Cloud Translation Basic (v2), standard model only

This is the simplest setup, and it works like the Azure subscription key did. Basic does not offer the Translation LLM.

- Go to **APIs & Services → Credentials → Create credentials → API key**.
- Restrict the key to the **Cloud Translation API**.
- Set it in `.env`:

  ```
  GOOGLE_TRANSLATE_API_KEY=your-api-key
  ```

At startup, the server logs which option and model are active:

```
Translation provider: Google Cloud Translation Advanced (v3) - project your-project-id, location global, model general/translation-llm
```

Until credentials are set, the pages still load with a built-in fallback language list, and translate requests return a "not configured" error.

## Label terminology

`Train_Data/` holds a terminology database collected from official EU legal texts (see `Train_Data/coverage_report.md`). `services/terminology.js` loads it at startup and applies it to every translation, single or mass:

- **Official wording.** CLP hazard and precautionary statements (and, for food labels, additive and allergen names) are replaced by the official text for the target language. The data covers Danish, Dutch, French, Italian, Portuguese (Portugal) and Spanish. Other languages are translated normally.
- **Kept as written.** E-numbers, H/EUH/P codes, CAS and EC numbers, unit symbols after a number (`g`, `mL`, `°C`…), and for cosmetic labels INCI and fragrance-allergen names.

Before a text is sent to Google, these spans are swapped for placeholders such as `[[1]]` and put back afterwards. A text that is only official wording or codes is answered without calling Google. If the translator ever damages a placeholder, that text is translated again without terminology.

Which lists apply depends on the **label type**, which the app detects from each text by itself (testers choose nothing):

| Label type | Detected from | Applies |
|---|---|---|
| `food` | E-numbers, food additive and allergen names, words such as *cooked*, *serve*, *kcal*, *best before* | Statements, codes and units, plus official food additive and allergen names |
| `cosmetic` (cosmetic or detergent) | Capitalised INCI and fragrance-allergen names, CI colour codes, words such as *skin*, *hair*, *shampoo*, *laundry* | Statements, codes and units, plus INCI and fragrance-allergen names kept as written |
| `general` | No clear evidence either way | Statements, codes and units |

Detection only picks food or cosmetic on clear evidence. Names on both lists, everyday words such as WATER, and words inside official statements (which appear on every kind of label) do not count. The single-translation page shows the detected type under the result; mass translation reports how many rows got each type. The API field `label_type` (`auto` by default, or `general`, `food`, `cosmetic`, `off`) can force a type; `off` gives plain machine translation for comparison.

Food and cosmetic lists are never combined, because many INCI names are also food words (CITRIC ACID, MILK, WATER). INCI names are only protected when written with capitals, as on ingredient lists; everyday words such as WATER only in full capitals. Statements with `…` fill-ins (25) cannot be matched literally and are skipped; one-word allergen names (milk, eggs) are left to the translator. If `Train_Data/` is missing, the app runs without terminology.

## Configuration reference

All settings are environment variables. See `.env.example` for the full annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP port (Azure App Service and Cloud Run set this automatically) |
| `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CREDENTIALS_JSON` | – | Option A: Advanced (v3) |
| `GOOGLE_TRANSLATE_MODEL` | `general/translation-llm` | Advanced model; `general/nmt` selects the standard model |
| `GOOGLE_TRANSLATE_API_KEY` | – | Option B: Basic (v2), standard model only |
| `TRANSLATE_BATCH_SIZE` | `25` | Texts per API request during mass translation |
| `TRANSLATE_MAX_CHARS_PER_REQUEST` | `5000` | Character cap per request (Google recommends ≤ 5,000) |
| `TRANSLATE_REQUEST_DELAY_MS` | `250` | Pause between batch requests |
| `TRANSLATE_MAX_RETRIES` | `5` | Attempts per batch when rate-limited (backoff 5s, 10s, 20s, 40s) |
| `DATABASE_URL` | – | `sqlite:///data/app.db`, `mssql://user:pass@host/db`, `postgres://user:pass@host/db`, or an ADO.NET connection string |
| `DATABASE_TYPE=sqlite`, `SQLITE_PATH` | `data/plm_translator.db` | Local SQLite database |
| `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USERNAME`, `AZURE_SQL_PASSWORD` | – | Azure SQL Database |
| `LST_CHUNK_SIZE`, `LST_MAX_WORKERS`, `LST_BATCH_SIZE`, `LST_MAX_RETRIES` | `1000`, `10`, `25`, `3` | Large-scale processing settings |
| `MAX_UPLOAD_MB` | `200` | Maximum Excel upload size |

Production mode starts when `WEBSITE_SITE_NAME` is set (Azure App Service) or `NODE_ENV=production` (Cloud Run's buildpacks set this). Production requires a database, configured in one of three ways (checked in this order):

- `SQLAZURECONNSTR_DefaultConnection`
- `DATABASE_URL`
- the `AZURE_SQL_*` variables

## Project structure

```
server.js                     Entry point (replaces run.py / gunicorn_config.py / startup.sh)
app.js                        Express app factory (replaces app.py)
config.js                     Environment, database and Google configuration (replaces config.py)
models.js                     Knex connection + test_results table (replaces models.py)
utils.js                      Helpers (replaces utils.py)
routes/main.js                Pages: /, /mass-translation, /test-results
routes/api.js                 REST API under /api
services/translator.js        Google Cloud Translation client (replaces the Azure translator service)
services/terminology.js       Label terminology from Train_Data/: official wording and protected terms
services/largeScaleTranslator.js  File validation, time estimates, chunked processing
services/massTranslation.js   Excel mass translation + background job processing
services/excel.js             Excel read/write helpers (replaces pandas/openpyxl)
services/cache.js             In-memory job status cache (replaces Flask-Caching)
templates/                    Nunjucks templates (same markup as the Flask version)
static/                       CSS, JS, images
Train_Data/                   Terminology database (official_terms.csv, do_not_translate.csv, coverage_report.md)
```

## API endpoints

These are the same as in the Python version:

| Method | Path | Description |
|---|---|---|
| GET | `/api/languages` | Supported target languages |
| POST | `/api/translate` | Translate `{text, target_language}` |
| GET | `/api/azure-user` | Current user info (name kept for frontend compatibility) |
| POST | `/api/save-test-results` | Save a test result |
| GET | `/api/test-results` | List results (`page`, `per_page`, `outcome`) or fetch one (`id`) |
| DELETE | `/api/test-results/:id` | Delete a test result |
| GET | `/api/export-test-results` | Excel export (`outcome`, `language`, `q`) |
| POST | `/api/validate-large-file` | Validate an uploaded Excel file |
| POST | `/api/estimate-processing-time` | Estimate `{record_count, target_languages}` |
| POST | `/api/mass-translate` | Translate an uploaded Excel file (`file`, `target_languages`, `tested_by`) |
| GET | `/api/translation-progress/:jobId` | Background job status |
| GET | `/api/download-template` | Mass translation Excel template |
| POST | `/api/download-translation-results` | Excel results for `{session_id}` |

## Differences from the Python version

- **Language codes follow Google's list.** For example, Chinese (Simplified) is `zh-CN` instead of Azure's `zh-Hans`. The "Common" preset on the mass translation page used Azure's `lzh` code, which is *Literary* Chinese; it now selects Simplified Chinese.
- **Hyphenated language codes are handled.** Stored `code-Name` values such as `zh-CN-Chinese (Simplified)` are parsed correctly for Excel downloads. The Python version only kept the part before the first hyphen (`zh`).
- **`.xls` files:** only `.xlsx` workbooks can be read. The Python version also failed on `.xls` because `xlrd` was not installed. The Node version shows a clear "save as .xlsx" message instead.
- **Mass translation session IDs** have a random suffix, so two uploads started in the same second no longer share (and mix) results.
- **Requests are batched by character count.** Batch requests are split by both text count and total characters, and transient errors (HTTP 503 / gRPC `UNAVAILABLE`) are retried along with rate limits.

## Deploying to Azure App Service (Linux, Node 20+)

1. Create a Node 20 LTS (or newer) Web App.
2. Deploy this folder (zip deploy, GitHub Actions, or local Git). `npm install` runs during the build when `SCM_DO_BUILD_DURING_DEPLOYMENT=true`.
3. Set the startup command to `npm start`. This is the default for Node apps.
4. Under **Configuration → Application settings**, add your Google credentials and database settings:
   - For service-account auth, `GOOGLE_CREDENTIALS_JSON` avoids having to upload a key file.
   - The existing `SQLAZURECONNSTR_DefaultConnection` connection string is supported.

Azure's front end ends any HTTP request after about 230 seconds. That limit applied to the Python version too. Split very large files into smaller uploads, or add a job queue on top of the background-processing functions in `services/massTranslation.js`.
