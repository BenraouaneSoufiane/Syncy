import { NextResponse } from "next/server";
import { runFivetranPipeline } from "../../../lib/run-pipeline";

export async function POST(request) {
  try {
    const body = await request.json();
    const required = getRequiredToolNodes(body.pipeline?.nodes || []);
    const missing = required.filter((node) => !hasConfig(node, body.configs || {}));

    if (missing.length) {
      return NextResponse.json({
        missingAuthorization: missing.map((node) => ({
          nodeId: node.id,
          toolId: node.data?.toolId,
          label: node.data?.label || node.data?.toolId
        })),
        message: "Configure every source and destination tool before running."
      });
    }

    const result = await runFivetranPipeline(body.pipeline || {}, body.configs || {});
    return NextResponse.json({ started: true, result });
  } catch (error) {
    return NextResponse.json({ message: error.message, detail: error.payload || null }, { status: error.status || 500 });
  }
}

function getRequiredToolNodes(nodes) {
  return nodes.filter((node) => {
    const kind = node.data?.kind;
    return (kind === "source" || kind === "destination") && node.data?.toolId;
  });
}

function hasConfig(node, configs) {
  const config = configs[node.id] || configs[node.data?.toolId];
  return Boolean(config && Object.keys(config).length);
}
