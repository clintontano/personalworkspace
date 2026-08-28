import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/database.types";

/** URL-safe slug from a title, with a short random suffix for uniqueness. */
export function slugify(title: string, fallback = "page"): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || fallback;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export type SiteRecord = { id: string; slug: string; published_at: string | null };

export async function fetchSite(pageId: string): Promise<SiteRecord | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("sites")
    .select("id, slug, published_at")
    .eq("page_id", pageId)
    .maybeSingle();
  return data;
}

export async function publishSite(
  pageId: string,
  workspaceId: string,
  title: string,
): Promise<SiteRecord> {
  const supabase = createClient();
  const existing = await fetchSite(pageId);
  if (existing) {
    const { data, error } = await supabase
      .from("sites")
      .update({ published_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("id, slug, published_at")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("sites")
    .insert({
      workspace_id: workspaceId,
      page_id: pageId,
      slug: slugify(title),
      published_at: new Date().toISOString(),
    })
    .select("id, slug, published_at")
    .single();
  if (error) throw error;
  return data;
}

export async function unpublishSite(siteId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("sites")
    .update({ published_at: null })
    .eq("id", siteId);
  if (error) throw error;
}

export type FormField = {
  propertyId: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
};

export type FormRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  fields: FormField[];
  enabled: boolean;
};

export async function fetchForms(databaseId: string): Promise<FormRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("forms")
    .select("id, slug, title, description, fields, enabled")
    .eq("database_id", databaseId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((f) => ({ ...f, fields: (f.fields ?? []) as FormField[] }));
}

export async function createForm(
  databaseId: string,
  workspaceId: string,
  title: string,
  fields: FormField[],
): Promise<FormRecord> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      database_id: databaseId,
      slug: slugify(title, "form"),
      title,
      fields: fields as unknown as Json,
    })
    .select("id, slug, title, description, fields, enabled")
    .single();
  if (error) throw error;
  return { ...data, fields: (data.fields ?? []) as FormField[] };
}

export async function updateForm(
  formId: string,
  patch: { title?: string; description?: string | null; fields?: FormField[]; enabled?: boolean },
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("forms")
    .update({
      ...patch,
      fields: patch.fields ? (patch.fields as unknown as Json) : undefined,
    })
    .eq("id", formId);
  if (error) throw error;
}

export async function deleteForm(formId: string) {
  const supabase = createClient();
  const { error } = await supabase.from("forms").delete().eq("id", formId);
  if (error) throw error;
}
