"use client";

import { Copy, Download, RefreshCw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AD_LEVEL_LABELS,
  AD_LEVELS,
  PORTAL_LABELS,
  type AdLevel,
  type Portal,
} from "@crm/shared/publications";
import {
  fetchBcuRateAction,
  rotateFeedTokenAction,
  saveExchangeRateAction,
  savePortalAccountAction,
} from "@/app/(app)/properties/publications/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";

export interface PortalAccountView {
  portal: Portal;
  enabled: boolean;
  accountRef: string | null;
  quotas: Partial<Record<AdLevel, number>>;
  feedUrl: string | null;
  used: Partial<Record<AdLevel, number>>;
}

type Result = { ok: boolean; error?: string; fieldErrors?: Record<string, string[]> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, errors, run };
}

export function PortalAccountCard({ a }: { a: PortalAccountView }) {
  const [enabled, setEnabled] = useState(a.enabled);
  const [accountRef, setAccountRef] = useState(a.accountRef ?? "");
  const [quotas, setQuotas] = useState<Record<string, string>>(
    Object.fromEntries(AD_LEVELS.map((l) => [l, a.quotas[l] != null ? String(a.quotas[l]) : ""])),
  );
  const { pending, errors, run } = useRun();
  const usesQuotas = a.portal !== "website";
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{PORTAL_LABELS[a.portal]}</h3>
        <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "Activo" : "Inactivo"}</Badge>
      </div>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const q: Record<string, number> = {};
          for (const [k, v] of Object.entries(quotas)) if (v.trim() !== "") q[k] = Number(v);
          run(
            () => savePortalAccountAction({ portal: a.portal, enabled, accountRef, quotas: q }),
            "Portal guardado",
          );
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Publicar en este portal
        </label>
        <Field
          label="Usuario / código de cliente en el portal"
          htmlFor={`acc-${a.portal}`}
          error={errors.accountRef}
        >
          <Input id={`acc-${a.portal}`} value={accountRef} onChange={(e) => setAccountRef(e.target.value)} />
        </Field>
        {usesQuotas && (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-xs text-muted-foreground">
              Cupos del plan por nivel (vacío = sin límite) · usados ahora
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AD_LEVELS.map((l) => (
                <label key={l} className="grid gap-1 text-xs">
                  <span>
                    {AD_LEVEL_LABELS[l]} <span className="text-muted-foreground">({a.used[l] ?? 0})</span>
                  </span>
                  <Input
                    inputMode="numeric"
                    className="h-8"
                    value={quotas[l] ?? ""}
                    onChange={(e) => setQuotas({ ...quotas, [l]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <Button type="submit" size="sm" loading={pending}>
            <Save /> Guardar
          </Button>
        </div>
      </form>
      {a.feedUrl && (
        <div className="grid gap-1 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Feed XML de avisos publicados (pasale esta dirección al portal o a tu sitio web; es secreta).
          </p>
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={a.feedUrl}
              className="h-8 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Copiar"
              onClick={() => {
                void navigator.clipboard?.writeText(a.feedUrl ?? "");
                toast.success("Copiado");
              }}
            >
              <Copy />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Regenerar"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("La dirección anterior deja de funcionar. ¿Regenerar?")) return;
                run(() => rotateFeedTokenAction(a.portal), "Nueva dirección generada");
              }}
            >
              <RefreshCw />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ExchangeRateForm({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveExchangeRateAction({ date, rate }),
          "Cotización guardada",
          () => setRate(""),
        );
      }}
    >
      <Field label="Fecha" htmlFor="xr-d" error={errors.date}>
        <Input id="xr-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Pesos por dólar" htmlFor="xr-r" error={errors.rate}>
        <Input
          id="xr-r"
          inputMode="decimal"
          placeholder="40,05"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={pending}>
        <Save /> Guardar
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => fetchBcuRateAction(), "Cotización del BCU guardada")}
      >
        <Download /> Traer del BCU
      </Button>
    </form>
  );
}
