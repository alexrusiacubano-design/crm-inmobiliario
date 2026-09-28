import { listDuplicateCandidates } from "@crm/core";
import { getDb } from "@crm/db";
import { formatCI } from "@crm/shared";
import { CopyCheck } from "lucide-react";
import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DuplicatePair } from "./pair";

export const metadata: Metadata = { title: "Duplicados" };

export default async function DuplicatesPage() {
  const { ctx } = await requirePagePermission("contact.merge");
  const pairs = await listDuplicateCandidates(getDb(), ctx);

  return (
    <>
      <PageHeader
        title="Posibles duplicados"
        description="Se detectan al crear o editar contactos: mismo documento, teléfono o email, o nombre muy parecido. Elegí cuál conservar y fusioná, o descartá el par."
      />
      {pairs.length === 0 ? (
        <Card>
          <EmptyState icon={CopyCheck} title="No hay duplicados pendientes" />
        </Card>
      ) : (
        <div className="grid gap-4">
          {pairs.map((p) => (
            <DuplicatePair
              key={p.id}
              id={p.id}
              score={p.score}
              reasons={p.reasons}
              a={{
                ...p.a,
                createdAt: p.a.createdAt.toISOString(),
                documentNumber:
                  p.a.documentType === "ci" && p.a.documentNumber
                    ? formatCI(p.a.documentNumber)
                    : p.a.documentNumber,
              }}
              b={{
                ...p.b,
                createdAt: p.b.createdAt.toISOString(),
                documentNumber:
                  p.b.documentType === "ci" && p.b.documentNumber
                    ? formatCI(p.b.documentNumber)
                    : p.b.documentNumber,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
