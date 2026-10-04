import { createHmac } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  automationRule,
  automationRun,
  automationSchedule,
  contactTag,
  dealReservation,
  lead,
  membership,
  membershipRole,
  notification,
  organization,
  propertyPublication,
  rentalContract,
  rentCharge,
  role,
  tag,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  AUTOMATION_TRIGGERS,
  EVENT_TRIGGERS,
  evaluateConditions,
  nextInRotation,
  renderAutomationText,
  type AutomationTrigger,
  type RunStatus,
} from "@crm/shared/automations";
import type { AutomationAction } from "@crm/shared/validation/automations";
import { addDaysYmd } from "@crm/shared/rentals";
import { loadContext, type RequestContext } from "../context";
import { createEvent } from "../agenda/events";
import { assignLead } from "../crm/leads";
import { dispatchPendingEvents, type EventHandler, type PendingEvent } from "../events";
import { loadSubject, type Subject } from "./facts";

type Rule = typeof automationRule.$inferSelect;

export function todayInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

/** "2026-10-05" + "10:00" en la zona de la organización → ISO con su desfase ("-03:00"). */
function localIso(ymd: string, hm: string, tz: string): string {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
  const offset = m ? `${m[1]}:${m[2] ?? "00"}` : "Z";
  return `${ymd}T${hm}:00${offset === "Z" ? "Z" : offset}`;
}

async function orgTz(db: DbOrTx, organizationId: string): Promise<string> {
  const [o] = await db
    .select({ tz: organization.timezone })
    .from(organization)
    .where(eq(organization.id, organizationId));
  return o?.tz || "America/Montevideo";
}

async function activeMemberIds(db: DbOrTx, organizationId: string, userIds: readonly string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.status, "active"),
        inArray(membership.userId, [...userIds]),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

async function usersWithRole(db: DbOrTx, organizationId: string, roleKey: string) {
  const rows = await db
    .selectDistinct({ userId: membership.userId })
    .from(membershipRole)
    .innerJoin(membership, eq(membership.id, membershipRole.membershipId))
    .innerJoin(role, eq(role.id, membershipRole.roleId))
    .where(
      and(
        eq(membershipRole.organizationId, organizationId),
        eq(membership.status, "active"),
        eq(role.key, roleKey),
        isNull(role.deletedAt),
      ),
    );
  return rows.map((r) => r.userId);
}

async function runAction(
  db: Db,
  rule: Rule,
  actx: RequestContext,
  subject: Subject,
  action: AutomationAction,
  tz: string,
  today: string,
  trigger: AutomationTrigger,
): Promise<string> {
  const text = (t: string) => renderAutomationText(t, subject.vars);
  if (action.type === "notify") {
    const targets =
      action.to === "assignee"
        ? subject.assigneeUserId
          ? [subject.assigneeUserId]
          : []
        : action.to === "role"
          ? await usersWithRole(db, rule.organizationId, action.roleKey ?? "")
          : action.userId
            ? [action.userId]
            : [];
    const active = [...(await activeMemberIds(db, rule.organizationId, targets))];
    if (!active.length) return "Sin destinatarios";
    await db.insert(notification).values(
      active.map((userId) => ({
        organizationId: rule.organizationId,
        userId,
        title: text(action.title),
        body: action.body ? text(action.body) : null,
        href: subject.href,
        ruleId: rule.id,
      })),
    );
    return `Notificación a ${active.length} usuario(s)`;
  }
  if (action.type === "task") {
    const assignee = action.to === "assignee" ? subject.assigneeUserId : (action.userId ?? null);
    if (!assignee) throw new Error("La entidad no tiene responsable");
    const due = addDaysYmd(today, action.dueInDays);
    await createEvent(db, actx, {
      type: "task",
      title: text(action.title).slice(0, 160),
      description: `Creada por la automatización «${rule.name}» · ${subject.label}`,
      startsAt: localIso(due, "10:00", tz),
      allDay: true,
      assignedUserId: assignee,
      contactId: subject.contactId,
      leadId: subject.leadId,
      propertyId: subject.propertyId,
    });
    return `Tarea para el ${due.split("-").reverse().join("/")}`;
  }
  if (action.type === "assign") {
    if (subject.entity !== "lead") throw new Error("Solo se asignan leads");
    const active = await activeMemberIds(db, rule.organizationId, action.userIds);
    const pool = action.userIds.filter((u) => active.has(u));
    const next = nextInRotation(pool, rule.state.lastAssignedUserId);
    if (!next) throw new Error("Ningún usuario de la rueda está activo");
    await db
      .update(automationRule)
      .set({ state: { ...rule.state, lastAssignedUserId: next } })
      .where(eq(automationRule.id, rule.id));
    rule.state = { ...rule.state, lastAssignedUserId: next };
    await assignLead(db, actx, { leadId: subject.id, assignedUserId: next });
    return "Lead asignado en rueda";
  }
  if (action.type === "tag") {
    if (!subject.contactId) return "Sin contacto para etiquetar";
    const name = action.tag.trim();
    await db.insert(tag).values({ organizationId: rule.organizationId, name }).onConflictDoNothing();
    const [t] = await db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.organizationId, rule.organizationId), eq(tag.name, name)));
    if (!t) throw new Error("No se pudo crear la etiqueta");
    await db.insert(contactTag).values({ contactId: subject.contactId, tagId: t.id }).onConflictDoNothing();
    return `Etiqueta «${name}»`;
  }
  // webhook
  const body = JSON.stringify({
    rule: { id: rule.id, name: rule.name },
    trigger,
    entity: { type: subject.entity, id: subject.id, label: subject.label, path: subject.href },
    facts: subject.facts,
    vars: subject.vars,
    sentAt: new Date().toISOString(),
  });
  const signature = createHmac("sha256", rule.secret).update(body).digest("hex");
  const res = await fetch(action.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "CRM-Inmobiliario-Automations/1",
      "X-CRM-Signature": `sha256=${signature}`,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`El webhook respondió ${res.status}`);
  return `Webhook ${res.status}`;
}

/**
 * Ejecuta una regla sobre una entidad. La fila del historial se inserta primero con
 * `dedupe_key` único: si ya existe, la regla ya corrió para esto y no se repite.
 */
export async function executeRule(
  db: Db,
  rule: Rule,
  subject: Subject,
  dedupeKey: string,
  opts: { tz: string; today: string },
): Promise<{ status: RunStatus; results: { action: string; ok: boolean; detail: string }[] } | null> {
  const trigger = rule.trigger as AutomationTrigger;
  const [run] = await db
    .insert(automationRun)
    .values({
      organizationId: rule.organizationId,
      ruleId: rule.id,
      trigger,
      dedupeKey,
      entityType: subject.entity,
      entityId: subject.id,
      entityLabel: subject.label,
    })
    .onConflictDoNothing()
    .returning();
  if (!run) return null;

  const results: { action: string; ok: boolean; detail: string }[] = [];
  let actx: RequestContext | null = null;
  try {
    actx = await loadContext(db, {
      userId: rule.createdById,
      organizationId: rule.organizationId,
      meta: { requestId: `automation:${rule.id}` },
    });
  } catch {
    results.push({ action: "context", ok: false, detail: "Quien creó la regla ya no tiene acceso" });
  }
  if (actx)
    for (const action of rule.actions) {
      try {
        results.push({
          action: action.type,
          ok: true,
          detail: await runAction(db, rule, actx, subject, action, opts.tz, opts.today, trigger),
        });
      } catch (e) {
        results.push({ action: action.type, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  const okCount = results.filter((r) => r.ok).length;
  const status: RunStatus = okCount === results.length ? "success" : okCount === 0 ? "error" : "partial";
  await db.update(automationRun).set({ status, results }).where(eq(automationRun.id, run.id));
  await db
    .update(automationRule)
    .set({ runCount: sql`${automationRule.runCount} + 1`, lastRunAt: new Date() })
    .where(eq(automationRule.id, rule.id));
  return { status, results };
}

async function enabledRules(db: DbOrTx, organizationId: string | null, triggers: readonly string[]) {
  return db
    .select()
    .from(automationRule)
    .where(
      and(
        organizationId ? eq(automationRule.organizationId, organizationId) : undefined,
        inArray(automationRule.trigger, [...triggers]),
        eq(automationRule.enabled, true),
        isNull(automationRule.deletedAt),
      ),
    );
}

/** Manejador del outbox: corre las reglas cuyo disparador es este evento. */
export async function runAutomationsForEvent(event: PendingEvent & { occurredAt?: Date }, db: Db) {
  const def = AUTOMATION_TRIGGERS[event.type as AutomationTrigger] as
    (typeof AUTOMATION_TRIGGERS)[AutomationTrigger] | undefined;
  if (!def || def.kind !== "event") return;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (payload._automation) return; // lo generó otra automatización: no se encadena
  const rules = await enabledRules(db, event.organizationId, [event.type]);
  if (!rules.length) return;
  const tz = await orgTz(db, event.organizationId);
  const today = todayInTz(tz);
  const subject = await loadSubject(db, event.organizationId, def.entity, event.aggregateId, {
    today,
    tz,
    payload,
  });
  if (!subject) return;
  for (const rule of rules) {
    // Una regla nueva no actúa sobre eventos anteriores a su creación.
    if (event.occurredAt && event.occurredAt < rule.createdAt) continue;
    if (!evaluateConditions(rule.conditions, subject.facts)) continue;
    await executeRule(db, rule, subject, `event:${event.id}`, { tz, today });
  }
}

const SCAN_LIMIT = 200;

/** Candidatos de un disparador programado: [id de la entidad, clave anti-repetición]. */
async function scheduleCandidates(
  db: DbOrTx,
  rule: Rule,
  today: string,
): Promise<{ id: string; key: string }[]> {
  const days = rule.days ?? 0;
  const org = rule.organizationId;
  switch (rule.trigger as AutomationTrigger) {
    case "schedule.lead_stale": {
      const rows = await db
        .select({
          id: lead.id,
          last: sql<string>`coalesce(${lead.lastContactAt}, ${lead.createdAt})::date::text`,
        })
        .from(lead)
        .where(
          and(
            eq(lead.organizationId, org),
            isNull(lead.deletedAt),
            notInArray(lead.status, ["won", "lost"]),
            lt(
              sql`coalesce(${lead.lastContactAt}, ${lead.createdAt})`,
              sql`now() - make_interval(days => ${days})`,
            ),
          ),
        )
        .limit(SCAN_LIMIT);
      return rows.map((r) => ({ id: r.id, key: `stale:${r.id}:${r.last}` }));
    }
    case "schedule.charge_overdue": {
      const rows = await db
        .select({ id: rentCharge.id })
        .from(rentCharge)
        .where(
          and(
            eq(rentCharge.organizationId, org),
            lte(rentCharge.dueDate, addDaysYmd(today, -days)),
            sql`coalesce((select sum(case when l.kind = 'discount' then -l.amount_minor else l.amount_minor end) from rent_charge_line l where l.charge_id = "rent_charge"."id"), 0) > coalesce((select sum(p.amount_minor) from rent_payment p where p.charge_id = "rent_charge"."id"), 0)`,
          ),
        )
        .limit(SCAN_LIMIT);
      return rows.map((r) => ({ id: r.id, key: `overdue:${r.id}` }));
    }
    case "schedule.contract_ending": {
      const rows = await db
        .select({ id: rentalContract.id, end: rentalContract.endDate })
        .from(rentalContract)
        .where(
          and(
            eq(rentalContract.organizationId, org),
            eq(rentalContract.status, "active"),
            isNull(rentalContract.deletedAt),
            gte(rentalContract.endDate, today),
            lte(rentalContract.endDate, addDaysYmd(today, days)),
          ),
        )
        .limit(SCAN_LIMIT);
      return rows.map((r) => ({ id: r.id, key: `ending:${r.id}:${r.end}` }));
    }
    case "schedule.reservation_expiring": {
      const rows = await db
        .select({ id: dealReservation.id, dealId: dealReservation.dealId, exp: dealReservation.expiresAt })
        .from(dealReservation)
        .where(
          and(
            eq(dealReservation.organizationId, org),
            eq(dealReservation.status, "active"),
            gte(dealReservation.expiresAt, today),
            lte(dealReservation.expiresAt, addDaysYmd(today, days)),
          ),
        )
        .limit(SCAN_LIMIT);
      return rows.map((r) => ({ id: r.dealId, key: `reservation:${r.id}:${r.exp}` }));
    }
    case "schedule.publication_expiring": {
      const rows = await db
        .select({ id: propertyPublication.id, exp: propertyPublication.expiresAt })
        .from(propertyPublication)
        .where(
          and(
            eq(propertyPublication.organizationId, org),
            eq(propertyPublication.status, "published"),
            gte(propertyPublication.expiresAt, today),
            lte(propertyPublication.expiresAt, addDaysYmd(today, days)),
          ),
        )
        .limit(SCAN_LIMIT);
      return rows.map((r) => ({ id: r.id, key: `publication:${r.id}:${r.exp}` }));
    }
    default:
      return [];
  }
}

/** Corre los disparadores programados (todas las organizaciones o una). */
export async function runScheduledAutomations(
  db: Db,
  opts: { organizationId?: string; now?: Date } = {},
): Promise<{ rules: number; runs: number }> {
  const triggers = Object.keys(AUTOMATION_TRIGGERS).filter(
    (k) => AUTOMATION_TRIGGERS[k as AutomationTrigger].kind === "schedule",
  );
  const rules = await enabledRules(db, opts.organizationId ?? null, triggers);
  let runs = 0;
  const tzCache = new Map<string, string>();
  for (const rule of rules) {
    const tz = tzCache.get(rule.organizationId) ?? (await orgTz(db, rule.organizationId));
    tzCache.set(rule.organizationId, tz);
    const today = todayInTz(tz, opts.now);
    const entity = AUTOMATION_TRIGGERS[rule.trigger as AutomationTrigger].entity;
    for (const c of await scheduleCandidates(db, rule, today)) {
      const subject = await loadSubject(db, rule.organizationId, entity, c.id, { today, tz });
      if (!subject || !evaluateConditions(rule.conditions, subject.facts)) continue;
      if (await executeRule(db, rule, subject, c.key, { tz, today })) runs++;
    }
  }
  return { rules: rules.length, runs };
}

/**
 * Corre los programados de una organización si pasó al menos `minIntervalMs` desde la última
 * vez (la marca se toma con un UPDATE condicional, así dos pedidos simultáneos no duplican).
 */
export async function maybeRunScheduledAutomations(
  db: Db,
  organizationId: string,
  minIntervalMs = 60 * 60 * 1000,
): Promise<boolean> {
  await db
    .insert(automationSchedule)
    .values({ organizationId, lastRunAt: new Date(0) })
    .onConflictDoNothing();
  const [claimed] = await db
    .update(automationSchedule)
    .set({ lastRunAt: new Date() })
    .where(
      and(
        eq(automationSchedule.organizationId, organizationId),
        lt(automationSchedule.lastRunAt, new Date(Date.now() - minIntervalMs)),
      ),
    )
    .returning();
  if (!claimed) return false;
  await runScheduledAutomations(db, { organizationId });
  return true;
}

/** Manejadores del outbox para los disparadores por evento (los usa el worker y la web). */
export function automationHandlers(): Map<string, readonly EventHandler[]> {
  return new Map(EVENT_TRIGGERS.map((t) => [t, [runAutomationsForEvent as EventHandler]]));
}

/** Entrega un lote de eventos pendientes corriendo las automatizaciones. */
export async function dispatchAutomations(db: Db, batchSize = 25): Promise<number> {
  return dispatchPendingEvents(db, automationHandlers(), batchSize);
}
