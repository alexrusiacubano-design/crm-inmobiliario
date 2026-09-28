import { MapPinOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={MapPinOff}
        title="Página no encontrada"
        description="La dirección no existe o el registro ya no está disponible."
        action={
          <Button asChild variant="secondary">
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
