"use client";

import { useState } from "react";
import { updateRowProperties } from "@/lib/db/data";
import type { Property, PropertyValue } from "@/lib/db/model";
import { PropertyCell } from "./cell";

export function PropertiesPanel({
  pageId,
  properties,
  initialValues,
}: {
  pageId: string;
  properties: Property[];
  initialValues: Record<string, PropertyValue>;
}) {
  const [values, setValues] = useState(initialValues);

  const onChange = (propertyId: string, value: PropertyValue) => {
    const merged = { ...values, [propertyId]: value };
    setValues(merged);
    void updateRowProperties(pageId, merged);
  };

  return (
    <div data-testid="properties-panel" className="mb-6 flex flex-col gap-1 border-b pb-4">
      {properties.map((p) => (
        <div key={p.id} className="grid grid-cols-[140px_1fr] items-center gap-2">
          <span className="text-sm text-muted-foreground">{p.name}</span>
          <PropertyCell
            property={p}
            value={values[p.id]}
            onChange={(value) => onChange(p.id, value)}
            className="rounded hover:bg-muted/60"
          />
        </div>
      ))}
    </div>
  );
}
