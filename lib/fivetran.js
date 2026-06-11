const FIVETRAN_BASE_URL = "https://api.fivetran.com";

export function authHeader(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) return null;
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

export function normalizeConnector(item) {
  const features = item.supported_features || item.features || [];
  return {
    id: item.id || item.service || item.name,
    name: item.name || item.id || "Unknown connector",
    type: item.type || item.category || "Other",
    description: item.description || "",
    iconUrl: item.icon_url || item.iconUrl || item.icons?.[0] || "",
    docsUrl: item.link_to_docs || item.docsUrl || "",
    status: item.service_status || item.status || "available",
    features: features.map((feature) => ({
      id: feature.id || feature.name,
      notes: feature.notes || ""
    }))
  };
}

export function scoreConnector(connector, prompt) {
  const text = [
    connector.id,
    connector.name,
    connector.type,
    connector.description,
    ...(connector.features || []).map((feature) => feature.id)
  ].join(" ").toLowerCase();
  const terms = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_ ]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);

  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 3;
    if (connector.id?.toLowerCase().includes(term)) score += 5;
    if (connector.name?.toLowerCase().includes(term)) score += 5;
  }

  const featureIds = new Set((connector.features || []).map((feature) => String(feature.id).toUpperCase()));
  if (featureIds.has("API_CONFIGURABLE")) score += 4;
  if (featureIds.has("AUTHORIZATION_VIA_API")) score += 3;
  if (featureIds.has("RE_SYNC")) score += 2;
  if (connector.status === "general_availability") score += 2;
  return score;
}

export async function fivetranRequest(endpoint, options = {}) {
  const response = await fetch(`${FIVETRAN_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      accept: "application/json;version=2",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? parseJson(text) : {};
  if (!response.ok) {
    const error = new Error(payload.message || payload.raw || `Fivetran returned ${response.status}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function fetchConnectorMetadata(prompt = "", limit = 80) {
  const payload = await fivetranRequest("/public/connector-types", {
    headers: { accept: "application/json" }
  });
  const items = payload?.data?.items || payload?.data || [];
  return items
    .map(normalizeConnector)
    .map((connector) => ({ ...connector, score: prompt ? scoreConnector(connector, prompt) : 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
