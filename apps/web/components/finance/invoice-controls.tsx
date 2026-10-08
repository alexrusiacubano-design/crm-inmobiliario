"use client";

import { FileCheck2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  RECEIVER_DOC_TYPE_LABELS,
  RECEIVER_DOC_TYPES,
  splitTax,
  type ReceiverDocType,
} from "@crm/shared/invoicing";
import {
  createInvoiceAction,
  issueInvoiceAction,
  voidInvoiceAction,
} from "@/app/(app)/finance/invoicing/actions";
import { price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

type Cur = "UYU" | "USD";
export interface InvoiceDraftInput {
  contactId: string | null;
  receiverName: string;
  receiverDocType: ReceiverDocType;
  receiverDoc: string;
  receiverAddress: string;
  currency: Cur;
  lines: { description: string; amount: string; sourceType: string | null; sourceId: string | null }[];
}

const toMinor = (v: string) => {
  const m = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(v.trim());
  return m ? BigInt(m[1] ?? "0") * 100n + BigInt(((m[2] ?? "") + "00").slice(0, 2)) : 0n;
};

export function InvoiceDialog({
  initial,
  label,
  variant,
}: {
  initial: InvoiceDraftInput;
  label: string;
  variant?: "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [taxIncluded, setTaxIncluded] = useState(false);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const totals = v.lines.reduce(
    (acc, l) => {
      const t = splitTax(toMinor(l.amount), taxIncluded);
      return { net: acc.net + t.netMinor, tax: acc.tax + t.taxMinor, total: acc.total + t.totalMinor };
    },
    { net: 0n, tax: 0n, total: 0n },
  );
  const err = (k: string) => errors[k];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant={variant}
        onClick={() => {
          setV(initial);
          setErrors({});
          setOpen(true);
        }}
      >
        <Plus /> {label}
      </Button>
      <DialogContent
        className="max-w-2xl"
        title="Factura (borrador)"
        description="Se guarda como borrador. Después emitís el CFE en DGI o tu proveedor y cargás la serie y el número."
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createInvoiceAction({ ...v, taxIncluded, notes });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success(`Borrador ${r.data.code} creado`);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Receptor (nombre o razón social)"
              htmlFor="iv-n"
              error={err("receiverName")}
              className="sm:col-span-2"
            >
              <Input
                id="iv-n"
                value={v.receiverName}
                onChange={(e) => setV({ ...v, receiverName: e.target.value })}
              />
            </Field>
            <Field label="Documento" htmlFor="iv-dt">
              <Select
                id="iv-dt"
                value={v.receiverDocType}
                onChange={(e) => setV({ ...v, receiverDocType: e.target.value as ReceiverDocType })}
              >
                {RECEIVER_DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {RECEIVER_DOC_TYPE_LABELS[d]}
                    {d === "rut" ? " (e-Factura)" : " (e-Ticket)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Número" htmlFor="iv-d" error={err("receiverDoc")}>
              <Input
                id="iv-d"
                value={v.receiverDoc}
                onChange={(e) => setV({ ...v, receiverDoc: e.target.value })}
              />
            </Field>
            <Field label="Dirección" htmlFor="iv-a" className="sm:col-span-2">
              <Input
                id="iv-a"
                value={v.receiverAddress}
                onChange={(e) => setV({ ...v, receiverAddress: e.target.value })}
              />
            </Field>
            <Field label="Moneda" htmlFor="iv-c" error={err("currency")}>
              <Select
                id="iv-c"
                value={v.currency}
                onChange={(e) => setV({ ...v, currency: e.target.value as Cur })}
              >
                <option value="USD">Dólares</option>
                <option value="UYU">Pesos</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox checked={taxIncluded} onChange={(e) => setTaxIncluded(e.target.checked)} />
              Los importes ya incluyen IVA
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Conceptos</legend>
            {err("lines") && <p className="text-xs text-danger">{err("lines")}</p>}
            {v.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
                <Input
                  aria-label="Concepto"
                  value={l.description}
                  onChange={(e) =>
                    setV({
                      ...v,
                      lines: v.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    })
                  }
                />
                <Input
                  aria-label="Monto"
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) =>
                    setV({
                      ...v,
                      lines: v.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                    })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Quitar"
                  onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setV({
                    ...v,
                    lines: [...v.lines, { description: "", amount: "", sourceType: null, sourceId: null }],
                  })
                }
              >
                <Plus /> Agregar concepto
              </Button>
            </div>
          </fieldset>
          <div className="ml-auto grid w-64 gap-1 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Neto</span>{" "}
              <span className="tabular">{price(totals.net, v.currency)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">IVA 22 %</span>{" "}
              <span className="tabular">{price(totals.tax, v.currency)}</span>
            </p>
            <p className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span> <span className="tabular">{price(totals.total, v.currency)}</span>
            </p>
          </div>
          <Field label="Notas (opcional)" htmlFor="iv-notes">
            <Textarea id="iv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar borrador
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IssueDialog({ id, code, today }: { id: string; code: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cfeSeries, setSeries] = useState("A");
  const [cfeNumber, setNumber] = useState("");
  const [issuedAt, setDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <FileCheck2 /> Marcar emitida
      </Button>
      <DialogContent
        title={`Emitir ${code}`}
        description="Emití el CFE en el portal de DGI o en tu proveedor de facturación y cargá acá la serie y el número que te dio."
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await issueInvoiceAction({ id, cfeSeries, cfeNumber, issuedAt });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Factura emitida");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Serie" htmlFor="is-s" error={errors.cfeSeries}>
              <Input id="is-s" value={cfeSeries} maxLength={2} onChange={(e) => setSeries(e.target.value)} />
            </Field>
            <Field label="Número" htmlFor="is-n" error={errors.cfeNumber}>
              <Input
                id="is-n"
                inputMode="numeric"
                value={cfeNumber}
                onChange={(e) => setNumber(e.target.value)}
              />
            </Field>
            <Field label="Fecha" htmlFor="is-d" error={errors.issuedAt}>
              <Input id="is-d" type="date" value={issuedAt} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceButton({ id, draft }: { id: string; draft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-danger"
      disabled={pending}
      onClick={() => {
        const reason = draft
          ? window.confirm("¿Borrar el borrador?") && "Borrador descartado"
          : window.prompt("Motivo de la anulación (recordá emitir la nota de crédito en DGI o tu proveedor)");
        if (!reason) return;
        start(async () => {
          const r = await voidInvoiceAction({ id, reason });
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.data.deleted ? "Borrador borrado" : "Factura anulada");
          router.refresh();
        });
      }}
    >
      {draft ? <Trash2 /> : <X />} {draft ? "Borrar" : "Anular"}
    </Button>
  );
}
