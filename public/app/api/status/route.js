import { NextResponse } from "next/server";
import { authHeader, fivetranRequest } from "../../../lib/fivetran";

export async function POST(request) {
  try {
    const body = await request.json();
    const authorization = authHeader(process.env.FIVETRAN_API_KEY, process.env.FIVETRAN_API_SECRET);
    if (!authorization || !body.connectionId) {
      return NextResponse.json({ message: "Fivetran credentials in .env.local and connection ID are required." }, { status: 400 });
    }

    const connection = await fivetranRequest(`/v1/connections/${encodeURIComponent(body.connectionId)}`, {
      headers: { authorization }
    });
    return NextResponse.json({ connection });
  } catch (error) {
    return NextResponse.json({ message: error.message, detail: error.payload || null }, { status: error.status || 500 });
  }
}
