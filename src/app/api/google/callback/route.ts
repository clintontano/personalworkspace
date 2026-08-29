import { NextResponse, type NextRequest } from "next/server";
import { emailFromIdToken, exchangeCode, hasRequiredScope } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const kind = request.nextUrl.searchParams.get("state") === "gmail" ? "gmail" : "calendar";
  if (!code) {
    return NextResponse.redirect(new URL("/app/settings?google=denied", request.url));
  }

  const tokens = await exchangeCode(request.nextUrl.origin, code);

  // A token without the scope we asked for is useless; storing it would turn
  // a clear consent mistake into an opaque 403 at first use.
  if (!hasRequiredScope(tokens.scope, kind)) {
    return NextResponse.redirect(
      new URL(`/app/settings?google=missing_scope&kind=${kind}`, request.url),
    );
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return NextResponse.redirect(new URL("/app?google=noworkspace", request.url));
  }

  const { data: existing } = await supabase
    .from("google_connections")
    .select("id, refresh_token")
    .eq("user_id", user.id)
    .eq("kind", kind)
    .maybeSingle();

  const record = {
    workspace_id: membership.workspace_id,
    user_id: user.id,
    kind,
    email: emailFromIdToken(tokens.id_token),
    access_token: tokens.access_token,
    // Google only returns a refresh token on the first consent; keep the old
    // one when a re-connect omits it.
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? "",
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };

  if (existing) {
    await supabase.from("google_connections").update(record).eq("id", existing.id);
  } else {
    await supabase.from("google_connections").insert(record);
  }

  return NextResponse.redirect(new URL("/app/settings?google=connected", request.url));
}
