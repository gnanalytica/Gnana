import { NextResponse } from "next/server";
import { auth } from "../../../../auth";

const API_URL = process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Get access token from session
  const accessToken = (session as unknown as Record<string, unknown>).accessToken;

  const response = await fetch(`${API_URL}/api/chat/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  // Stream the SSE response through to the client
  if (!response.body) {
    return NextResponse.json({ error: "No response body" }, { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
