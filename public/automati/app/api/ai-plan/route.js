import { NextResponse } from "next/server";
import { enforcePromptRoute, fallbackPipeline, inferPromptRoute, pipelineSchema, sanitizePipeline } from "../../../lib/pipeline";

export async function POST(request) {
  try {
    const body = await request.json();
    const prompt = body.prompt || "";
    const tools = body.tools || [];
    const route = inferPromptRoute(prompt, tools);
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

    if (!apiKey) {
      return NextResponse.json({
        source: "heuristic",
        pipeline: fallbackPipeline(prompt, tools),
        message: "Set GEMINI_API_KEY in .env.local to generate the pipeline with Gemini."
      });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Build a Fivetran automation pipeline as a React Flow graph.",
                  "Use only available connector tool IDs.",
                  "Infer the requested source and destination from the user prompt. For example, 'move my GitHub data to Supabase' must choose GitHub as a source node and Supabase as a destination node.",
                  route.sourceTool ? `Required source tool: ${route.sourceTool.id} (${route.sourceTool.name}).` : "",
                  route.destinationTool ? `Required destination tool: ${route.destinationTool.id} (${route.destinationTool.name}).` : "",
                  "Include source nodes for chosen Fivetran tools, transform nodes for logic, a destination node when needed, and an output node.",
                  "Set source connector nodes to data.kind='source' and destination connector nodes to data.kind='destination'.",
                  "Keep labels short and operational.",
                  JSON.stringify({ prompt, availableTools: tools.slice(0, 40) })
                ].join("\n\n")
              }
            ]
          }
        ],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: "APPLICATION_JSON",
              schema: pipelineSchema
            }
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({
        source: "heuristic",
        pipeline: fallbackPipeline(prompt, tools),
        geminiError: data.error?.message || data.message || "Gemini request failed."
      });
    }

    const text = extractGeminiText(data);
    const pipeline = enforcePromptRoute(sanitizePipeline(JSON.parse(text)), prompt, tools);
    return NextResponse.json({ source: "gemini", model, pipeline, rawResponseId: data.responseId || null });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

function extractGeminiText(data) {
  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) return part.text;
    }
  }
  throw new Error("Gemini response did not include output text.");
}
