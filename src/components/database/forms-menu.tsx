"use client";

import { Check, Copy, FileInput, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Property } from "@/lib/db/model";
import {
  createForm,
  deleteForm,
  fetchForms,
  updateForm,
  type FormRecord,
} from "@/lib/publish";

/** Manage public forms that write rows into this database. */
export function FormsMenu({
  databaseId,
  workspaceId,
  databaseTitle,
  properties,
}: {
  databaseId: string;
  workspaceId: string;
  databaseTitle: string;
  properties: Property[];
}) {
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    if (loaded) return;
    setForms(await fetchForms(databaseId));
    setLoaded(true);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const create = async () => {
    setBusy(true);
    const fields = [
      { propertyId: "title", label: "Title", required: true },
      ...properties
        .filter((p) => p.type !== "relation")
        .slice(0, 4)
        .map((p) => ({ propertyId: p.id, label: p.name })),
    ];
    const form = await createForm(
      databaseId,
      workspaceId,
      `${databaseTitle || "Untitled"} form`,
      fields,
    );
    setForms((prev) => [...prev, form]);
    setBusy(false);
  };

  const toggleField = async (form: FormRecord, propertyId: string, on: boolean) => {
    const fields = on
      ? [
          ...form.fields,
          {
            propertyId,
            label:
              propertyId === "title"
                ? "Title"
                : properties.find((p) => p.id === propertyId)?.name,
          },
        ]
      : form.fields.filter((f) => f.propertyId !== propertyId);
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, fields } : f)));
    await updateForm(form.id, { fields });
  };

  const remove = async (formId: string) => {
    setForms((prev) => prev.filter((f) => f.id !== formId));
    await deleteForm(formId);
  };

  const fieldOptions = [
    { id: "title", name: "Title" },
    ...properties.filter((p) => p.type !== "relation").map((p) => ({ id: p.id, name: p.name })),
  ];

  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
          <FileInput className="h-4 w-4" />
          Forms
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">Public forms</p>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can submit a row to this database.
            </p>
          </div>

          {!loaded ? (
            <p data-testid="forms-loading" className="text-xs text-muted-foreground">
              Loading…
            </p>
          ) : null}

          {forms.map((form) => {
            const url = `${origin}/f/${form.slug}`;
            const selected = new Set(form.fields.map((f) => f.propertyId));
            return (
              <div key={form.id} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex items-center gap-1">
                  <input
                    readOnly
                    data-testid="form-url"
                    value={url}
                    className="h-8 flex-1 rounded-md border bg-muted px-2 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Copy form link"
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      setCopied(form.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                  >
                    {copied === form.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Delete form"
                    onClick={() => void remove(form.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {fieldOptions.map((option) => (
                    <label
                      key={option.id}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <Checkbox
                        checked={selected.has(option.id)}
                        onCheckedChange={(checked) =>
                          void toggleField(form, option.id, checked === true)
                        }
                      />
                      {option.name}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={url} target="_blank" rel="noreferrer">Open form</a>
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={form.enabled}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        setForms((prev) =>
                          prev.map((f) => (f.id === form.id ? { ...f, enabled } : f)),
                        );
                        void updateForm(form.id, { enabled });
                      }}
                    />
                    Accepting responses
                  </label>
                </div>
              </div>
            );
          })}

          {loaded ? (
          <Button
            size="sm"
            variant={forms.length > 0 ? "outline" : "default"}
            disabled={busy}
            data-testid="create-form"
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "New form"}
          </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
