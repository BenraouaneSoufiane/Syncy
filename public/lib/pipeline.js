export const pipelineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "nodes", "edges", "inputs", "outputs"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    nodes: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "position", "data"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["input", "default", "output"] },
          position: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" }
            }
          },
          data: {
            type: "object",
            additionalProperties: false,
            required: ["label", "kind", "toolId", "description"],
            properties: {
              label: { type: "string" },
              kind: { type: "string", enum: ["intent", "source", "transform", "destination", "output"] },
              toolId: { type: "string" },
              description: { type: "string" }
            }
          }
        }
      }
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "source", "target", "animated"],
        properties: {
          id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          animated: { type: "boolean" }
        }
      }
    },
    inputs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "label", "key", "required", "placeholder"],
        properties: {
          nodeId: { type: "string" },
          label: { type: "string" },
          key: { type: "string" },
          required: { type: "boolean" },
          placeholder: { type: "string" }
        }
      }
    },
    outputs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "description", "sourceNodeId"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          sourceNodeId: { type: "string" }
        }
      }
    }
  }
};

export function fallbackPipeline(prompt, tools = []) {
  const route = inferPromptRoute(prompt, tools);
  const sourceTool = route.sourceTool || tools[0];
  const destinationTool = route.destinationTool;
  const selected = [sourceTool].filter(Boolean);
  const sourceNodes = selected.map((tool, index) => ({
    id: `source_${tool.id || index}`,
    type: "default",
    position: { x: 300, y: 80 + index * 150 },
    data: {
      label: tool.name || tool.id || "Fivetran source",
      kind: "source",
      toolId: tool.id || "",
      description: tool.description || "Fivetran source connection"
    }
  }));
  const destinationNode = destinationTool
    ? {
        id: `destination_${destinationTool.id}`,
        type: "default",
        position: { x: 700, y: 150 },
        data: {
          label: destinationTool.name || "Destination",
          kind: "destination",
          toolId: destinationTool.id || "",
          description: destinationTool.description || "Pipeline destination"
        }
      }
    : null;

  const nodes = [
    {
      id: "intent",
      type: "input",
      position: { x: 20, y: 150 },
      data: { label: "Automation intent", kind: "intent", toolId: "", description: prompt || "User automation request" }
    },
    ...sourceNodes,
    {
      id: "transform",
      type: "default",
      position: { x: 590, y: 150 },
      data: { label: "Normalize and model data", kind: "transform", toolId: "", description: "Prepare synced data for the requested output." }
    },
    ...(destinationNode ? [destinationNode] : []),
    {
      id: "output",
      type: "output",
      position: { x: destinationNode ? 1000 : 900, y: 150 },
      data: { label: "Retrieve output", kind: "output", toolId: "", description: "Read connection status, sync results, and destination output." }
    }
  ];

  const edges = [
    ...sourceNodes.map((node) => ({ id: `intent-${node.id}`, source: "intent", target: node.id, animated: true })),
    ...sourceNodes.map((node) => ({ id: `${node.id}-transform`, source: node.id, target: "transform", animated: true })),
    ...(destinationNode
      ? [
          { id: `transform-${destinationNode.id}`, source: "transform", target: destinationNode.id, animated: true },
          { id: `${destinationNode.id}-output`, source: destinationNode.id, target: "output", animated: true }
        ]
      : [{ id: "transform-output", source: "transform", target: "output", animated: true }])
  ];

  return {
    title: "Generated automation pipeline",
    summary: "A pipeline draft was generated from the request and selected Fivetran tools.",
    nodes,
    edges,
    inputs: sourceNodes.map((node) => ({
      nodeId: node.id,
      label: `${node.data.label} config`,
      key: node.data.toolId,
      required: true,
      placeholder: `{ "${node.data.toolId}_credential": "..." }`
    })),
    outputs: [{ label: "Pipeline run output", description: "Connection creation and sync status.", sourceNodeId: "output" }]
  };
}

export function inferPromptRoute(prompt, tools = []) {
  const lowerPrompt = prompt.toLowerCase();
  const fromTo = lowerPrompt.match(/\bfrom\s+([a-z0-9 _-]+?)\s+to\s+([a-z0-9 _-]+?)(?:[.,;!?]|\s*$)/);
  const moveTo = lowerPrompt.match(/\bmove\s+(?:my\s+)?([a-z0-9 _-]+?)\s+data\s+to\s+([a-z0-9 _-]+?)(?:[.,;!?]|\s*$)/);
  const match = fromTo || moveTo;
  const sourceName = cleanToolName(match?.[1] || (lowerPrompt.includes("github") ? "github" : ""));
  const destinationName = cleanToolName(match?.[2] || destinationFromPrompt(lowerPrompt));

  return {
    sourceName,
    destinationName,
    sourceTool: findOrCreateTool(tools, sourceName, "Source"),
    destinationTool: findOrCreateTool(tools, destinationName, "Destination")
  };
}

export function enforcePromptRoute(pipeline, prompt, tools = []) {
  const route = inferPromptRoute(prompt, tools);
  if (!route.sourceTool && !route.destinationTool) return pipeline;

  let nodes = [...(pipeline.nodes || [])];
  let edges = [...(pipeline.edges || [])];

  if (route.sourceTool) {
    nodes = removeWrongKind(nodes, route.sourceTool.id, "source");
    if (!nodes.some((node) => node.data?.kind === "source" && sameTool(node.data?.toolId, route.sourceTool.id))) {
      nodes.splice(1, 0, routeNode(route.sourceTool, "source", { x: 300, y: 120 }));
    } else {
      nodes = nodes.map((node) => sameTool(node.data?.toolId, route.sourceTool.id) ? withKind(node, "source") : node);
    }
  }

  if (route.destinationTool) {
    nodes = removeWrongKind(nodes, route.destinationTool.id, "destination");
    if (!nodes.some((node) => node.data?.kind === "destination" && sameTool(node.data?.toolId, route.destinationTool.id))) {
      nodes.splice(Math.max(nodes.length - 1, 1), 0, routeNode(route.destinationTool, "destination", { x: 760, y: 120 }));
    } else {
      nodes = nodes.map((node) => sameTool(node.data?.toolId, route.destinationTool.id) ? withKind(node, "destination") : node);
    }
  }

  edges = ensureRouteEdges(nodes, edges);
  return { ...pipeline, nodes, edges };
}

function findTool(tools, query) {
  if (!query) return null;
  return tools.find((tool) => {
    const text = `${tool.id || ""} ${tool.name || ""}`.toLowerCase();
    return text.includes(query);
  });
}

function findOrCreateTool(tools, query, type) {
  if (!query) return null;
  return findTool(tools, query) || knownTool(query, type);
}

function knownTool(query, type) {
  const id = safeId(query).toLowerCase();
  const names = {
    github: "GitHub",
    snowflake: "Snowflake",
    supabase: "Supabase",
    bigquery: "BigQuery",
    postgres: "PostgreSQL",
    postgresql: "PostgreSQL",
    redshift: "Redshift"
  };
  return {
    id: id === "postgresql" ? "postgres" : id,
    name: names[id] || query.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    type,
    description: `${names[id] || query} ${type.toLowerCase()}`
  };
}

function cleanToolName(value) {
  return String(value || "")
    .replace(/\b(my|the|data|database|warehouse|source|destination)\b/g, " ")
    .trim()
    .split(/\s+/)[0] || "";
}

function destinationFromPrompt(lowerPrompt) {
  for (const name of ["snowflake", "supabase", "bigquery", "redshift", "postgres", "postgresql"]) {
    if (lowerPrompt.includes(name)) return name;
  }
  return "";
}

function sameTool(left, right) {
  return safeId(left).toLowerCase() === safeId(right).toLowerCase();
}

function removeWrongKind(nodes, toolId, intendedKind) {
  return nodes.filter((node) => !sameTool(node.data?.toolId, toolId) || node.data?.kind === intendedKind);
}

function withKind(node, kind) {
  return {
    ...node,
    data: {
      ...node.data,
      kind
    }
  };
}

function routeNode(tool, kind, position) {
  return {
    id: `${kind}_${safeId(tool.id).toLowerCase()}`,
    type: "default",
    position,
    data: {
      label: tool.name || tool.id,
      kind,
      toolId: tool.id,
      description: tool.description || `${tool.name || tool.id} ${kind}`
    }
  };
}

function ensureRouteEdges(nodes, edges) {
  const source = nodes.find((node) => node.data?.kind === "source");
  const transform = nodes.find((node) => node.data?.kind === "transform");
  const destination = nodes.find((node) => node.data?.kind === "destination");
  const output = nodes.find((node) => node.data?.kind === "output") || nodes.find((node) => node.type === "output");
  const nextEdges = [...edges];

  addMissingEdge(nextEdges, source?.id, transform?.id || destination?.id || output?.id);
  addMissingEdge(nextEdges, transform?.id, destination?.id || output?.id);
  addMissingEdge(nextEdges, destination?.id, output?.id);
  return nextEdges;
}

function addMissingEdge(edges, source, target) {
  if (!source || !target || source === target) return;
  if (edges.some((edge) => edge.source === source && edge.target === target)) return;
  edges.push({ id: `${source}-${target}`, source, target, animated: true });
}

export function sanitizePipeline(pipeline) {
  return {
    ...pipeline,
    nodes: (pipeline.nodes || []).map((node, index) => ({
      id: safeId(node.id || `node_${index}`),
      type: ["input", "output", "default"].includes(node.type) ? node.type : "default",
      position: {
        x: Number(node.position?.x ?? 120 + index * 220),
        y: Number(node.position?.y ?? 120)
      },
      data: {
        label: String(node.data?.label || node.id || `Step ${index + 1}`),
        kind: node.data?.kind || "transform",
        toolId: node.data?.toolId || "",
        description: node.data?.description || ""
      }
    })),
    edges: (pipeline.edges || []).map((edge, index) => ({
      id: safeId(edge.id || `edge_${index}`),
      source: safeId(edge.source),
      target: safeId(edge.target),
      animated: edge.animated !== false
    }))
  };
}

export function safeId(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9_-]/g, "_");
}
