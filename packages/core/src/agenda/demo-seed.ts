import { and, asc, count, eq, isNull } from "drizzle-orm";
import { calendarEvent, lead, organization, property, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import type { EventType, VisitOutcome } from "@crm/shared/agenda";
import { ctxForDemo } from "../properties/demo-seed";
import { closeEvent, createEvent } from "./events";

const HOUR = 3_600_000;

/** Redondea a la media hora para que los horarios DEMO se vean naturales. */
function at(hoursFromNow: number): Date {
  const t = Date.now() + hoursFromNow * HOUR;
  return new Date(Math.round(t / (30 * 60000)) * 30 * 60000);
}

interface DemoEvent {
  agent: string;
  type: EventType;
  title: string;
  in: number;
  duration?: number;
  withProperty?: boolean;
  withClient?: boolean;
  close?: {
    status: "done" | "no_show" | "cancelled";
    outcome?: VisitOutcome;
    rating?: number;
    feedback?: string;
  };
}

const EVENTS: DemoEvent[] = [
  {
    agent: "agente",
    type: "visit",
    title: "Visita con cliente (DEMO)",
    in: 3,
    duration: 1,
    withProperty: true,
    withClient: true,
  },
  {
    agent: "agente",
    type: "call",
    title: "Llamar para confirmar segunda visita (DEMO)",
    in: 1,
    withClient: true,
  },
  {
    agent: "agente",
    type: "visit",
    title: "Visita de ayer sin cerrar (DEMO)",
    in: -22,
    duration: 1,
    withProperty: true,
    withClient: true,
  },
  {
    agent: "agente",
    type: "visit",
    title: "Visita realizada (DEMO)",
    in: -50,
    duration: 1,
    withProperty: true,
    withClient: true,
    close: {
      status: "done",
      outcome: "second_visit",
      rating: 4,
      feedback: "Le gustó la luz; vuelve con la pareja.",
    },
  },
  {
    agent: "agente",
    type: "meeting",
    title: "Reunión con propietario por la exclusividad (DEMO)",
    in: 27,
    duration: 1,
  },
  { agent: "agente", type: "reminder", title: "Renovar fotos de la publicación (DEMO)", in: 50 },
  {
    agent: "agente2",
    type: "visit",
    title: "Visita en Punta del Este (DEMO)",
    in: 26,
    duration: 1,
    withProperty: true,
    withClient: true,
  },
  { agent: "director", type: "meeting", title: "Reunión semanal de equipo (DEMO)", in: 70, duration: 1 },
];

/** Agenda DEMO cargada con los servicios reales (permisos, auditoría y timeline). */
export async function seedDemoAgenda(db: Db): Promise<{ skipped: boolean; events: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(calendarEvent)
    .where(eq(calendarEvent.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, events: 0 };

  let n = 0;
  for (const d of EVENTS) {
    const ctx = await ctxForDemo(db, org.id, d.agent);
    const props = await db
      .select({ id: property.id })
      .from(property)
      .where(
        and(
          eq(property.organizationId, org.id),
          eq(property.assignedUserId, ctx.userId),
          isNull(property.deletedAt),
        ),
      )
      .orderBy(asc(property.code));
    const leads = await db
      .select({ id: lead.id, contactId: lead.contactId })
      .from(lead)
      .where(
        and(eq(lead.organizationId, org.id), eq(lead.assignedUserId, ctx.userId), isNull(lead.deletedAt)),
      )
      .orderBy(asc(lead.code));
    if (d.withProperty && props.length === 0) continue;
    const prop = props[n % Math.max(props.length, 1)];
    const client = leads[n % Math.max(leads.length, 1)];
    const startsAt = at(d.in);
    const e = await createEvent(db, ctx, {
      type: d.type,
      title: d.title,
      startsAt: startsAt.toISOString(),
      endsAt: d.duration ? new Date(startsAt.getTime() + d.duration * HOUR).toISOString() : null,
      propertyId: d.withProperty ? prop?.id : null,
      leadId: d.withClient ? client?.id : null,
    });
    if (d.close) await closeEvent(db, ctx, { id: e.id, ...d.close });
    n += 1;
  }
  return { skipped: false, events: n };
}
