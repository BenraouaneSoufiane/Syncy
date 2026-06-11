import { NextResponse } from "next/server";
import { authHeader, fivetranRequest } from "../../../lib/fivetran";
import { safeId } from "../../../lib/pipeline";

export async function POST(request) {
  try {
    const body = await request.json();
    const pipeline = body.pipeline || {};
    const sourceNodes = (pipeline.nodes || []).filter((node) => node.data?.kind === "source" && node.data?.toolId);
    const dryRun = process.env.FIVETRAN_DRY_RUN !== "false";
    const authorization = authHeader(process.env.FIVETRAN_API_KEY, process.env.FIVETRAN_API_SECRET);

    const planned = sourceNodes.map((node) => buildConnectionPayload(node, body));

    if (dryRun || !authorization) {
      return NextResponse.json({
        mode: "dry_run",
        message: "Pipeline prepared. Set FIVETRAN_DRY_RUN=false and provide Fivetran credentials in .env.local to create connections.",
        plannedConnections: planned,
        graph: { nodes: pipeline.nodes || [], edges: pipeline.edges || [] }
      });
    }

    if (!process.env.FIVETRAN_GROUP_ID) {
      return NextResponse.json({ message: "FIVETRAN_GROUP_ID is required in .env.local to ship to Fivetran." }, { status: 400 });
    }

    const results = [];
    for (const payload of planned) {
      const created = await fivetranRequest("/v1/connections", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify(payload)
      });

      const connectionId = created?.data?.id;
      let sync = null;
      if (process.env.FIVETRAN_RUN_SYNC !== "false" && connectionId) {
        sync = await fivetranRequest(`/v1/connections/${encodeURIComponent(connectionId)}/sync`, {
          method: "POST",
          headers: { authorization },
          body: JSON.stringify({})
        });
      }

      results.push({ service: payload.service, connectionId, created, sync });
    }

    return NextResponse.json({ mode: "live", results });
  } catch (error) {
    return NextResponse.json({ message: error.message, detail: error.payload || null }, { status: error.status || 500 });
  }
}

function buildConnectionPayload(node, body) {
  const service = node.data.toolId;
  const configs = parseJsonEnv(process.env.FIVETRAN_CONNECTOR_CONFIGS);
  const schemaPrefix = safeId(process.env.FIVETRAN_SCHEMA_PREFIX || "syncy").toLowerCase();
  const schemaService = safeId(service).toLowerCase();
  const schema = `${schemaPrefix}_${schemaService}`;
  const config = normalizeConnectionConfig(service, configs[node.id] || configs[service] || {}, schema);
  return {
    service,
    group_id: process.env.FIVETRAN_GROUP_ID || "<destination_group_id>",
    schema,
    schedule_type: "auto",
    sync_frequency: Number(process.env.FIVETRAN_SYNC_FREQUENCY || 60),
    paused: false,
    config
  };
}

function normalizeConnectionConfig(service, rawConfig, schema) {
  const config = { ...rawConfig };
  if (String(service).toLowerCase() !== "github") return config;
  const token = config.access_token || config.personal_access_token || config.pat || config.token || config.github_token || "";
  const pats = normalizeTokenList(config.pats || config.personal_access_tokens || config.personalAccessTokens || token);
  const repository = config.repository || config.repo || "";
  const owner = config.owner || config.organization || "";
  const authMode = config.auth_mode || config.authMode || (pats.length ? "PersonalAccessToken" : "OAuth");
  const syncMode = config.sync_mode || config.syncMode || "SpecificRepositories";

  delete config.access_token;
  delete config.personal_access_token;
  delete config.pat;
  delete config.token;
  delete config.github_token;
  delete config.pats;
  delete config.personal_access_tokens;
  delete config.personalAccessTokens;
  delete config.authMode;
  delete config.syncMode;
  delete config.owner;
  delete config.organization;
  delete config.repository;
  delete config.repo;

  return {
    ...config,
    schema: config.schema || schema,
    auth_mode: authMode,
    ...(repository ? { repositories: [owner ? `${owner}/${repository}` : repository] } : {}),
    ...(repository ? { sync_mode: syncMode } : {}),
    ...(pats.length ? { pats } : {})
  };
}

function normalizeTokenList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((token) => String(token).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseJsonEnv(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
