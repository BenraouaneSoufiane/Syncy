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
  const config = configs[node.id] || configs[service] || {};
  const schemaPrefix = safeId(process.env.FIVETRAN_SCHEMA_PREFIX || "syncy").toLowerCase();
  const schemaService = safeId(service).toLowerCase();
  return {
    service,
    group_id: process.env.FIVETRAN_GROUP_ID || "<destination_group_id>",
    schema: `${schemaPrefix}_${schemaService}`,
    schedule_type: "auto",
    sync_frequency: Number(process.env.FIVETRAN_SYNC_FREQUENCY || 60),
    paused: false,
    config
  };
}

function parseJsonEnv(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
