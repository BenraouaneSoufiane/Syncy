# Syncy

Syncy is an AI-assisted Fivetran pipeline builder built with Next.js. It lets a user describe an automation goal, turns that prompt into a pipeline diagram, collects tool authorization details, and can prepare or run Fivetran connection work.

## Features

- Prompt-based pipeline generation with Gemini when `GEMINI_API_KEY` is configured.
- Heuristic fallback pipeline generation when Gemini is not configured.
- Live Fivetran connector metadata loading from the public connector catalog.
- Editable React Flow pipeline diagram.
- Source and destination authorization forms.
- Dry-run mode for previewing Fivetran connection payloads before creating anything.

## Requirements

- Node.js 18 or newer
- npm

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5000
```

## Environment Variables

Create a `.env.local` file for local configuration. All variables are optional unless you want live Gemini or Fivetran operations.

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

FIVETRAN_API_KEY=
FIVETRAN_API_SECRET=
FIVETRAN_GROUP_ID=
FIVETRAN_DRY_RUN=true
FIVETRAN_RUN_SYNC=true
FIVETRAN_SCHEMA_PREFIX=syncy
FIVETRAN_SYNC_FREQUENCY=60
FIVETRAN_CONNECTOR_CONFIGS={}
```

By default, Syncy uses dry-run mode. Set `FIVETRAN_DRY_RUN=false` and provide valid Fivetran credentials to create live connections.

## Scripts

```bash
npm run dev     # Start the local development server
npm run build   # Build the production app
npm run start   # Start the production server on 127.0.0.1:5000
```

## Project Structure

```text
app/                 Next.js app routes and UI
app/api/             API routes for planning, running, and Fivetran helpers
app/diagram/         React Flow pipeline diagram experience
lib/fivetran.js      Fivetran API helpers and connector scoring
lib/pipeline.js      Pipeline schema, fallback generation, and sanitization
lib/run-pipeline.js  Pipeline execution helpers
```

## Basic Workflow

1. Enter an automation prompt on the home page.
2. Syncy ranks relevant Fivetran tools and generates a pipeline.
3. Review or edit the diagram.
4. Authorize required source and destination nodes.
5. Run the pipeline in dry-run or live Fivetran mode.
