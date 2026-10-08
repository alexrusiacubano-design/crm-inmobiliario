import { PrintButton } from "./print-button";

export interface OrgInfo {
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

/**
 * Hoja A4 para imprimir o guardar como PDF desde el navegador. Siempre en claro (independiente
 * del tema) y sin la interfaz del CRM.
 */
export function PrintSheet({
  org,
  title,
  number,
  date,
  back,
  footer,
  children,
}: {
  org: OrgInfo;
  title: string;
  number?: string | null;
  date: string;
  back?: { href: string; label: string };
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-neutral-200 py-6 print:bg-white print:py-0" style={{ colorScheme: "light" }}>
      <style>
        {"@page { size: A4; margin: 14mm; } @media print { html, body { background: #fff !important; } }"}
      </style>
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        {back ? (
          <a href={back.href} className="text-sm text-neutral-700 hover:underline">
            ← {back.label}
          </a>
        ) : (
          <span />
        )}
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-[14mm] text-[13px] leading-relaxed text-neutral-900 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-6 flex items-start justify-between gap-6 border-b border-neutral-300 pb-4">
          <div>
            <p className="text-lg font-semibold">{org.name}</p>
            <p className="text-[11px] text-neutral-600">
              {[org.legalName, org.taxId ? `RUT ${org.taxId}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="text-[11px] text-neutral-600">
              {[org.address, org.phone, org.email, org.website].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold uppercase tracking-wide">{title}</p>
            {number && <p className="font-mono text-[12px]">{number}</p>}
            <p className="text-[11px] text-neutral-600">{date}</p>
          </div>
        </header>
        {children}
        <footer className="mt-10 border-t border-neutral-300 pt-3 text-[10px] text-neutral-500">
          {footer ?? `Documento generado por ${org.name}. No es un comprobante fiscal (CFE).`}
        </footer>
      </article>
    </div>
  );
}

export function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 py-1 ${strong ? "border-t border-neutral-400 font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
