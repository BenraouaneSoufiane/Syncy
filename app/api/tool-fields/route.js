import { NextResponse } from "next/server";
import { fivetranRequest } from "../../../lib/fivetran";

const fallbackFields = {
  github: [
    { key: "pats", label: "GitHub PATs", type: "password", required: true, placeholder: "ghp_... or comma-separated tokens" },
    { key: "owner", label: "Owner or organization", type: "text", required: true, placeholder: "acme" },
    { key: "repository", label: "Repository", type: "text", required: false, placeholder: "optional repository name" }
  ],
  supabase: [
    { key: "database_url", label: "Database connection URL", type: "password", required: true, placeholder: "postgresql://..." },
    { key: "project_url", label: "Project URL", type: "text", required: false, placeholder: "https://project.supabase.co" },
    { key: "service_role_key", label: "Service role key", type: "password", required: false, placeholder: "eyJ..." }
  ],
  snowflake: [
    { key: "host", label: "Snowflake host", type: "text", required: true, placeholder: "account.region.snowflakecomputing.com" },
    { key: "port", label: "Port", type: "text", required: true, placeholder: "443" },
    { key: "user", label: "User", type: "text", required: true, placeholder: "SYNCY_USER" },
    { key: "password", label: "Password", type: "password", required: true, placeholder: "password" },
    { key: "database", label: "Database", type: "text", required: true, placeholder: "ANALYTICS" },
    { key: "warehouse", label: "Warehouse", type: "text", required: true, placeholder: "COMPUTE_WH" },
    { key: "auth", label: "Auth method", type: "text", required: true, placeholder: "PASSWORD" },
    { key: "role", label: "Role", type: "text", required: false, placeholder: "SYSADMIN" }
  ]
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const toolId = searchParams.get("toolId") || "";

  if (!toolId) {
    return NextResponse.json({ message: "toolId is required." }, { status: 400 });
  }

  try {
    const metadata = await fetchToolMetadata(toolId);
    const fields = extractFields(metadata);
    return NextResponse.json({
      source: fields.length ? "fivetran" : "fallback",
      toolId,
      fields: fields.length ? fields : fallbackFor(toolId)
    });
  } catch {
    return NextResponse.json({ source: "fallback", toolId, fields: fallbackFor(toolId) });
  }
}

async function fetchToolMetadata(toolId) {
  const endpoints = [
    `/public/connector-types/${encodeURIComponent(toolId)}`,
    `/public/connector-types/${encodeURIComponent(toolId)}/schemas`
  ];

  for (const endpoint of endpoints) {
    try {
      return await fivetranRequest(endpoint, { headers: { accept: "application/json" } });
    } catch {
      // Try the next known metadata shape.
    }
  }
  return null;
}

function extractFields(metadata) {
  const config = metadata?.data?.config || metadata?.data?.configuration || metadata?.config || {};
  const properties = config.properties || config.fields || [];
  if (Array.isArray(properties)) {
    return properties.map(normalizeField).filter(Boolean);
  }
  return Object.entries(properties).map(([key, value]) => normalizeField({ key, name: key, ...value })).filter(Boolean);
}

function normalizeField(field) {
  const key = field.key || field.name || field.id;
  if (!key) return null;
  return {
    key,
    label: field.label || field.title || key.replace(/_/g, " "),
    type: field.secret || field.sensitive || field.format === "password" ? "password" : "text",
    required: Boolean(field.required),
    placeholder: field.placeholder || ""
  };
}

function fallbackFor(toolId) {
  const id = String(toolId).toLowerCase();
  if (fallbackFields[id]) return fallbackFields[id];
  return [{ key: "api_key", label: "API key or access token", type: "password", required: true, placeholder: "credential" }];
}
