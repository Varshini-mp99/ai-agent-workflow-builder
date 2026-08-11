import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "HTTP request step executed successfully.",
    source: "workflow-builder",
    timestamp: new Date().toISOString(),
  });
}