import { authHeader, fivetranRequest } from "./fivetran";
import { safeId } from "./pipeline";

export async function runFivetranPipeline(pipeline, runtimeConfigs = {}) {
  const sourceNodes = (pipeline.nodes || []).filter((node) => node.data?.kind === "source" && node.data?.toolId);
  const destinationNode = (pipeline.nodes || []).find((node) => node.data?.kind === "destination" && node.data?.toolId);
  const dryRun = process.env.FIVETRAN_DRY_RUN === "true";
  const authorization = authHeader(process.env.FIVETRAN_API_KEY, process.env.FIVETRAN_API_SECRET);
  const groupId = process.env.FIVETRAN_GROUP_ID || destinationGroupPlaceholder(destinationNode, runtimeConfigs);
  const plannedConnections = sourceNodes.map((node) => buildConnectionPayload(node, runtimeConfigs, groupId));

  if (!sourceNodes.length) {
    const error = new Error("No source connector exists in this diagram.");
    error.status = 400;
    throw error;
  }

  if (dryRun) {
    return {
      mode: "dry_run",
      message: "Run prepared. Set FIVETRAN_DRY_RUN=false to create the Fivetran destination/source and start sync.",
      plannedConnections
    };
  }

  if (!authorization) {
    const error = new Error("FIVETRAN_API_KEY and FIVETRAN_API_SECRET are required in .env.local to run the sync.");
    error.status = 400;
    throw error;
  }

  const destination = await resolveDestination(destinationNode, runtimeConfigs, authorization);
  const liveGroupId = destination.groupId || process.env.FIVETRAN_GROUP_ID;
  if (!liveGroupId) {
    const error = new Error("Configure a destination node, or set FIVETRAN_GROUP_ID in .env.local.");
    error.status = 400;
    throw error;
  }

  const liveConnections = sourceNodes.map((node) => buildConnectionPayload(node, runtimeConfigs, liveGroupId));
  const results = [];
  for (const payload of liveConnections) {
    let created;
    try {
      created = await fivetranRequest("/v1/connections", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw withStage(error, `Fivetran rejected ${payload.service} source connection config`);
    }
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

  return { mode: "live", destination: destination.created || null, results };
}

function buildConnectionPayload(node, runtimeConfigs, groupId) {
  const service = node.data.toolId;
  const configs = { ...parseJsonEnv(process.env.FIVETRAN_CONNECTOR_CONFIGS), ...runtimeConfigs };
  const rawConfig = findRuntimeConfig(configs, node);
  const config = normalizeConnectionConfig(service, rawConfig);
  const schemaPrefix = safeId(process.env.FIVETRAN_SCHEMA_PREFIX || "syncy").toLowerCase();
  const schemaService = safeId(service).toLowerCase();
  return {
    service,
    group_id: groupId,
    schema: `${schemaPrefix}_${schemaService}`,
    schedule_type: "auto",
    sync_frequency: Number(process.env.FIVETRAN_SYNC_FREQUENCY || 60),
    paused: false,
    config
  };
}

function normalizeConnectionConfig(service, rawConfig) {
  const config = { ...rawConfig };
  if (String(service).toLowerCase() !== "github") return config;

  const token =
    config.access_token ||
    config.personal_access_token ||
    config.token ||
    config.github_token ||
    config.auth?.access_token ||
    config.auth?.personal_access_token ||
    "";
  const repository = config.repository || config.repo || "";
  const owner = config.owner || config.organization || "";

  delete config.access_token;
  delete config.personal_access_token;
  delete config.token;
  delete config.github_token;
  delete config.auth;
  delete config.owner;
  delete config.organization;
  delete config.repository;
  delete config.repo;

  return {
    ...config,
    ...(repository ? { repositories: [owner ? `${owner}/${repository}` : repository] } : {}),
    auth: token ? { access_token: token } : {}
  };
}

async function resolveDestination(node, runtimeConfigs, authorization) {
  if (process.env.FIVETRAN_GROUP_ID) return { groupId: process.env.FIVETRAN_GROUP_ID };
  if (!node?.data?.toolId) return { groupId: "" };

  const configs = { ...parseJsonEnv(process.env.FIVETRAN_CONNECTOR_CONFIGS), ...runtimeConfigs };
  const config = normalizeDestinationConfig(node.data.toolId, findRuntimeConfig(configs, node));
  if (!Object.keys(config).length) return { groupId: "" };

  const group = await createGroup(node, authorization);
  const groupId = group?.data?.id;
  if (!groupId) {
    const error = new Error("Fivetran did not return a group ID after creating the destination group.");
    error.status = 400;
    throw error;
  }

  const payload = {
    group_id: groupId,
    service: node.data.toolId,
    region: process.env.FIVETRAN_DESTINATION_REGION || "GCP_US_EAST4",
    time_zone_offset: process.env.FIVETRAN_DESTINATION_TIME_ZONE_OFFSET || "0",
    run_setup_tests: true,
    config
  };

  let created;
  try {
    created = await fivetranRequest("/v1/destinations", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw withStage(error, `Fivetran rejected ${node.data.toolId} destination config`);
  }
  return { groupId: created?.data?.group_id || groupId, created, group };
}

async function createGroup(node, authorization) {
  const groupName = [
    process.env.FIVETRAN_GROUP_NAME_PREFIX || "syncy",
    safeId(node.data?.toolId || "destination").toLowerCase(),
    Date.now()
  ].join("_");

  return await fivetranRequest("/v1/groups", {
    method: "POST",
    headers: {
      authorization,
      accept: "application/json"
    },
    body: JSON.stringify({ name: groupName })
  });
}

function destinationGroupPlaceholder(node, runtimeConfigs) {
  if (process.env.FIVETRAN_GROUP_ID) return process.env.FIVETRAN_GROUP_ID;
  if (!node) return "<destination_group_id>";
  const configs = { ...parseJsonEnv(process.env.FIVETRAN_CONNECTOR_CONFIGS), ...runtimeConfigs };
  const config = findRuntimeConfig(configs, node);
  return Object.keys(config).length ? `<created_${node.data.toolId}_destination_group_id>` : "<destination_group_id>";
}

function normalizeDestinationConfig(service, rawConfig) {
  const config = { ...rawConfig };
  if (String(service).toLowerCase() !== "snowflake") return config;

  if (config.host) {
    config.host = String(config.host)
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
  }
  config.port = Number(config.port || 443);
  config.auth = config.auth || "PASSWORD";

  return {
    ...config
  };
}

function withStage(error, stage) {
  const wrapped = new Error(`${stage}: ${error.message}`);
  wrapped.status = error.status;
  wrapped.payload = error.payload;
  return wrapped;
}

function findRuntimeConfig(configs, node) {
  const ids = [
    node.id,
    node.data?.toolId,
    `node-${String(node.id || "").replace(/_/g, "-")}`,
    `node_${String(node.id || "").replace(/-/g, "_")}`,
    `node-${String(node.data?.toolId || "").replace(/_/g, "-")}`,
    `node_${String(node.data?.toolId || "").replace(/-/g, "_")}`
  ].filter(Boolean);

  for (const id of ids) {
    if (configs[id]) return configs[id];
  }
  return {};
}

function parseJsonEnv(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
