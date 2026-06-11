import { NextResponse } from "next/server";
import { fetchConnectorMetadata } from "../../../lib/fivetran";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const prompt = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit") || 80);
    const connectors = await fetchConnectorMetadata(prompt, limit);
    return NextResponse.json({ source: "fivetran", connectors });
  } catch (error) {
    return NextResponse.json({ message: error.message, detail: error.payload || null }, { status: error.status || 500 });
  }
}
