import { notFound } from "next/navigation";
import type { Property } from "@/lib/db/model";
import { createPublicClient } from "@/lib/public-client";
import { PublicForm } from "./public-form";

export type PublicFormField = {
  propertyId: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
};

type PublicFormData = {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicFormField[];
  properties: Property[];
};

export default async function FormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createPublicClient();
  const { data } = await supabase.rpc("get_public_form", { p_slug: slug });

  if (!data) notFound();
  const form = data as unknown as PublicFormData;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <PublicForm form={form} />
    </main>
  );
}
