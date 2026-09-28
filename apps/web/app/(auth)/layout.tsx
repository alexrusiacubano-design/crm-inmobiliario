export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
      <aside className="relative hidden overflow-hidden bg-[oklch(0.3_0.05_200)] lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.45_0.08_195/.7),transparent_60%)]" />
        <svg
          className="absolute bottom-0 left-0 w-full text-[oklch(0.22_0.04_200)]"
          viewBox="0 0 600 260"
          preserveAspectRatio="none"
        >
          <path
            fill="currentColor"
            d="M0 260V170h40v-40h30v40h20V90h50v80h25v-50h35v50h30V60l40-30 40 30v110h20v-70h45v70h30v-40h30v40h25V120h45v50h30v-30h35v120z"
          />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12 text-[oklch(0.96_0.01_195)]">
          <p className="text-sm font-medium tracking-wide opacity-80">Inmobiliaria CRM</p>
          <div className="max-w-md pb-40">
            <p className="text-3xl font-semibold leading-tight tracking-tight">
              De la captación a la liquidación, en un solo lugar.
            </p>
            <p className="mt-3 text-sm opacity-75">
              Ventas, alquileres y administración para inmobiliarias de Uruguay.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
