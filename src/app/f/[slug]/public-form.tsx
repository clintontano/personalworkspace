"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Property, PropertyValue } from "@/lib/db/model";
import { createPublicClient } from "@/lib/public-client";
import type { PublicFormField } from "./page";

type FormData = {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicFormField[];
  properties: Property[];
};

export function PublicForm({ form }: { form: FormData }) {
  const [values, setValues] = useState<Record<string, PropertyValue>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(form.properties.map((p) => [p.id, p]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    setError(null);
    const supabase = createPublicClient();
    const { error: rpcError } = await supabase.rpc("submit_public_form", {
      p_slug: form.slug,
      p_data: values as never,
    });
    if (rpcError) {
      setError(rpcError.message.replace(/^.*missing required field/, "Missing required field:"));
      setState("idle");
      return;
    }
    setState("done");
  };

  if (state === "done") {
    return (
      <div className="rounded-lg border p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold">Thanks!</h1>
        <p className="text-sm text-muted-foreground">Your response was recorded.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setValues({});
            setState("idle");
          }}
        >
          Submit another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">{form.title}</h1>
        {form.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>
        ) : null}
      </div>

      {form.fields.map((field) => {
        const property = field.propertyId === "title" ? null : byId.get(field.propertyId);
        const label =
          field.label ?? (field.propertyId === "title" ? "Title" : property?.name ?? "");
        const value = values[field.propertyId];
        const set = (v: PropertyValue) =>
          setValues((prev) => ({ ...prev, [field.propertyId]: v }));

        return (
          <div key={field.propertyId} className="flex flex-col gap-2">
            <Label htmlFor={field.propertyId}>
              {label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            {field.propertyId === "title" || property?.type === "text" || property?.type === "url" ? (
              <Input
                id={field.propertyId}
                type={property?.type === "url" ? "url" : "text"}
                placeholder={field.placeholder}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(e.target.value)}
              />
            ) : property?.type === "number" ? (
              <Input
                id={field.propertyId}
                type="number"
                value={typeof value === "number" ? String(value) : ""}
                onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
              />
            ) : property?.type === "date" ? (
              <Input
                id={field.propertyId}
                type="date"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(e.target.value || null)}
              />
            ) : property?.type === "checkbox" ? (
              <Checkbox
                id={field.propertyId}
                checked={value === true}
                onCheckedChange={(checked) => set(checked === true)}
              />
            ) : property?.type === "select" ? (
              <select
                id={field.propertyId}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(e.target.value || null)}
              >
                <option value="">—</option>
                {(property.config.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            ) : property?.type === "multi_select" ? (
              <div className="flex flex-wrap gap-3">
                {(property.config.options ?? []).map((o) => {
                  const selected = Array.isArray(value) ? value : [];
                  return (
                    <label key={o.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={selected.includes(o.id)}
                        onCheckedChange={(checked) =>
                          set(
                            checked === true
                              ? [...selected, o.id]
                              : selected.filter((s) => s !== o.id),
                          )
                        }
                      />
                      {o.name}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}

      <Button type="submit" disabled={state === "sending"} className="self-start">
        {state === "sending" ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
