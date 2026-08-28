import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces(id, name)")
    .eq("user_id", user!.id);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Phase 0: Foundation</CardTitle>
          <CardDescription>
            Auth, workspaces, membership and RLS are wired up.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="flex flex-col gap-2">
            {(memberships ?? []).map((m) => (
              <li
                key={m.workspaces!.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <span className="font-medium">{m.workspaces!.name}</span>
                <span className="text-muted-foreground">{m.role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-muted-foreground">
            This list is fetched through RLS: you only see workspaces you are a
            member of. Phase 1 replaces this screen with pages and the block
            editor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
