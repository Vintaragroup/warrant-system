# Shared Config

Documents environment variables that appear across multiple services.

## Variables Used by All Three Services

| Variable    | Default     | Description               |
| ----------- | ----------- | ------------------------- |
| `MONGO_URI` | (none)      | MongoDB connection string |
| `MONGO_DB`  | `warrantdb` | Target database name      |

## Variables Used by inmate-enrichment + dashboard

| Variable    | Description             |
| ----------- | ----------------------- |
| `REDIS_URL` | Redis connection string |

## Variables Unique to inmate-enrichment

`PDL_API_KEY`, `PIPL_API_KEY`, `WHITEPAGES_API_KEY`, `OPENAI_API_KEY`,
`HCSO_BASE_URL`, `HCSO_SCRAPE_ENABLED`, `HCSO_SCRAPE_MODE`,
`BOND_THRESHOLD`, `ENRICHMENT_WINDOW_HOURS`, `IDEMPOTENCY_WINDOW_SECONDS`,
`AUTO_ENRICH_ENABLED`, `AUTO_ENRICH_SWEEP_CRON`, `RAW_PAYLOAD_TTL_HOURS`,
`QUEUE_CONCURRENCY`, `SUBJECTS_COLLECTION`, `PARTY_PULL_PREFER_STATEWIDE`,
`PROVIDER_WHITEPAGES_ENABLED`, `PROVIDER_PIPL_ENABLED`

## Variables Unique to dashboard (server/)

`WEB_ORIGIN`, `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_*`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
`EMAIL_FROM`, `APP_NAME`

## Variables Unique to warrantdb-pipeline

`HARRIS_BASE_FILES_URL`, `HARRIS_DATASETS_PAGE`
