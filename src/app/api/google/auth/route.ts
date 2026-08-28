import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl, googleConfigured, SCOPES } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!googleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local (see .env.example).",
      },
      { status: 501 },
    );
  }

  const kind = (request.nextUrl.searchParams.get("kind") ?? "calendar") as keyof typeof SCOPES;
  return NextResponse.redirect(buildAuthUrl(request.nextUrl.origin, kind));
}
