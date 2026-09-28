import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={ShieldAlert}
        title="No tenés acceso a esta sección"
        description="Tu rol no incluye este permiso. Si lo necesitás, pedíselo a un administrador."
        action={
          <Button asChild variant="secondary">
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
