import { and, asc, count, desc, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  acquisition,
  auditLog,
  contact,
  department,
  locality,
  neighborhood,
  ownerProfile,
  property,
  propertyExpense,
  propertyMedia,
  propertyOwner,
  propertyPrice,
  propertyPriceHistory,
  user,
  valuation,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  ACTIVE_PROPERTY_STATUSES,
  canTransitionProperty,
  normalizeText,
  parseMoney,
  parsePercentToBasisPoints,
  PROPERTY_STATUS_LABELS,
  publishChecklist,
  type Currency,
  type PriceField,
  type PropertyOperation,
} from "@crm/shared";
import { SCOPE_RANK, widestScope } from "@crm/shared/rbac";
import {
  propertyInputSchema,
  propertyListSchema,
  propertyStatusSchema,
  setOwnersSchema,
  setPricesSchema,
  updatePropertySchema,
} from "@crm/shared/validation/property";
import { uuidSchema } from "@crm/shared/validation";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { contactRef, logActivity, resolveAssignment } from "../crm/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { nextCode } from "../sequences";
import { propertyDisplayTitle, propertyRef, syncPropertySearch, syncPublicationsWithStatus } from "./helpers";

type PropertyInputParsed = ReturnType<typeof propertyInputSchema.parse>;

function propertyValues(input: PropertyInputParsed) {
  return {
    type: input.type,
    operations: input.operations,
    title: input.title,
    description: input.description,
    departmentId: input.departmentId,
    localityId: input.localityId,
    neighborhoodId: input.neighborhoodId,
    address: input.address,
    unit: input.unit,
    padron: input.padron,
    latitude: input.latitude,
    longitude: input.longitude,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    suites: input.suites,
    garages: input.garages,
    totalArea: input.totalArea,
    builtArea: input.builtArea,
    floor: input.floor,
    yearBuilt: input.yearBuilt,
    orientation: input.orientation,
    condition: input.condition,
    features: input.features,
    petsAllowed: input.petsAllowed,
    furnished: input.furnished,
    commissionBasisPoints: input.commissionPercent
      ? parsePercentToBasisPoints(input.commissionPercent)
      : null,
    internalNotes: input.internalNotes,
  };
}

/** Coherencia geográfica: el barrio pertenece a la localidad y la localidad al departamento. */
async function assertGeo(
  tx: DbOrTx,
  input: { departmentId: number | null; localityId: number | null; neighborhoodId: number | null },
) {
  let departmentId = input.departmentId;
  if (input.neighborhoodId) {
    const [n] = await tx.select().from(neighborhood).where(eq(neighborhood.id, input.neighborhoodId));
    if (!n) throw new ValidationError("Barrio inválido", { neighborhoodId: ["Barrio inválido"] });
    if (input.localityId && n.localityId !== input.localityId) {
      throw new ValidationError("El barrio no pertenece a la localidad", {
        neighborhoodId: ["No corresponde a la localidad"],
      });
    }
  }
  if (input.localityId) {
    const [l] = await tx.select().from(locality).where(eq(locality.id, input.localityId));
    if (!l) throw new ValidationError("Localidad inválida", { localityId: ["Localidad inválida"] });
    if (departmentId && l.departmentId !== departmentId) {
      throw new ValidationError("La localidad no pertenece al departamento", {
        localityId: ["No corresponde al departamento"],
      });
    }
    departmentId = l.departmentId;
  }
  return departmentId;
}

/** Asignar a otro agente requiere `property.update` con alcance mayor a "propios". */
async function resolveResponsible(tx: DbOrTx, ctx: RequestContext, requested: string | null) {
  const assignedUserId = requested ?? ctx.userId;
  if (assignedUserId !== ctx.userId) {
    const scope = widestScope(ctx.grants, "property.update");
    if (!scope || SCOPE_RANK[scope] <= SCOPE_RANK.own)
      throw new ForbiddenError("No podés asignar propiedades a otros agentes");
  }
  return { assignedUserId, ...(await resolveAssignment(tx, ctx.organizationId, assignedUserId)) };
}

async function replaceExpenses(tx: DbOrTx, propertyId: string, expenses: PropertyInputParsed["expenses"]) {
  await tx.delete(propertyExpense).where(eq(propertyExpense.propertyId, propertyId));
  if (expenses.length) {
    await tx.insert(propertyExpense).values(
      expenses.map((e) => ({
        propertyId,
        kind: e.kind,
        label: e.label,
        amountMinor: parseMoney(e.amount ?? "0", e.currency).amountMinor,
        currency: e.currency,
        period: e.period,
      })),
    );
  }
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(property)
    .where(
      and(eq(property.id, id), eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt)),
    )
    .for("update");
  if (!row) throw new NotFoundError("Propiedad");
  return row;
}

export async function createProperty(
  db: Db,
  ctx: RequestContext,
  rawInput: unknown,
  options: { captadorUserId?: string } = {},
) {
  requirePermission(ctx, "property.create");
  const input = parseInput(propertyInputSchema, rawInput);
  return db.transaction((tx) => insertProperty(tx, ctx, input, options));
}

/** Uso interno (también desde la captación): crea la propiedad dentro de una transacción. */
export async function insertProperty(
  tx: DbOrTx,
  ctx: RequestContext,
  input: PropertyInputParsed,
  options: { captadorUserId?: string } = {},
) {
  requirePermission(ctx, "property.create");
  const departmentId = await assertGeo(tx, input);
  const responsible = await resolveResponsible(tx, ctx, input.assignedUserId);
  const code = await nextCode(tx, ctx.organizationId, "PROP");
  const [row] = await tx
    .insert(property)
    .values({
      organizationId: ctx.organizationId,
      code,
      ...propertyValues(input),
      departmentId,
      ...responsible,
      captadorUserId: options.captadorUserId ?? ctx.userId,
      createdById: ctx.userId,
    })
    .returning();
  if (!row) throw new Error("No se pudo crear la propiedad");
  await replaceExpenses(tx, row.id, input.expenses);
  await syncPropertySearch(tx, [row.id]);
  await writeAudit(tx, ctx, {
    action: "property.create",
    entityType: "property",
    entityId: row.id,
    after: row,
  });
  await emitEvent(tx, ctx, { type: "property.created", aggregateType: "property", aggregateId: row.id });
  return row;
}

export async function updateProperty(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updatePropertySchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, "property.update", propertyRef(before));
    const departmentId = await assertGeo(tx, input);

    const reassigned = !!input.assignedUserId && input.assignedUserId !== before.assignedUserId;
    const responsible = reassigned
      ? await resolveResponsible(tx, ctx, input.assignedUserId)
      : { assignedUserId: before.assignedUserId, branchId: before.branchId, teamId: before.teamId };

    // Quitar una operación con precio cargado deja precios huérfanos: se eliminan con historial.
    const removedOps = before.operations.filter((op) => !input.operations.includes(op));
    const [after] = await tx
      .update(property)
      .set({ ...propertyValues(input), departmentId, ...responsible })
      .where(eq(property.id, before.id))
      .returning();
    if (removedOps.length) {
      const orphan = await tx
        .select()
        .from(propertyPrice)
        .where(and(eq(propertyPrice.propertyId, before.id), inArray(propertyPrice.operation, removedOps)));
      for (const p of orphan) {
        for (const [field, value] of [
          ["list", p.listMinor],
          ["owner_asking", p.ownerAskingMinor],
          ["minimum", p.minimumMinor],
        ] as const) {
          if (value !== null) {
            await tx.insert(propertyPriceHistory).values({
              organizationId: ctx.organizationId,
              propertyId: before.id,
              operation: p.operation,
              field,
              currency: p.currency,
              oldMinor: value,
              newMinor: null,
              reason: "Operación quitada de la propiedad",
              changedById: ctx.userId,
            });
          }
        }
      }
      await tx
        .delete(propertyPrice)
        .where(and(eq(propertyPrice.propertyId, before.id), inArray(propertyPrice.operation, removedOps)));
    }
    await replaceExpenses(tx, before.id, input.expenses);
    await syncPropertySearch(tx, [before.id]);
    await writeAudit(tx, ctx, {
      action: "property.update",
      entityType: "property",
      entityId: before.id,
      before,
      after,
    });
    if (reassigned) {
      await writeAudit(tx, ctx, {
        action: "property.assignment_change",
        entityType: "property",
        entityId: before.id,
        before: { assignedUserId: before.assignedUserId },
        after: { assignedUserId: responsible.assignedUserId },
      });
    }
    await emitEvent(tx, ctx, { type: "property.updated", aggregateType: "property", aggregateId: before.id });
    return after;
  });
}

export async function checklistFor(tx: DbOrTx, p: typeof property.$inferSelect) {
  // Secuencial: puede correr dentro de una transacción (un único cliente de conexión).
  const prices = await tx.select().from(propertyPrice).where(eq(propertyPrice.propertyId, p.id));
  const photos = await tx
    .select({ n: count(), covers: sql<number>`count(*) filter (where ${propertyMedia.isCover})::int` })
    .from(propertyMedia)
    .where(and(eq(propertyMedia.propertyId, p.id), eq(propertyMedia.kind, "photo")));
  const owners = await tx.select().from(propertyOwner).where(eq(propertyOwner.propertyId, p.id));
  return publishChecklist({
    title: p.title,
    description: p.description,
    localityId: p.localityId,
    operations: p.operations,
    listPrices: prices.map((pr) => ({ operation: pr.operation, hasListPrice: pr.listMinor !== null })),
    photoCount: photos[0]?.n ?? 0,
    hasCover: (photos[0]?.covers ?? 0) > 0,
    ownerCount: owners.length,
    ownerShareTotal: owners.reduce((acc, o) => acc + o.shareBasisPoints, 0),
  });
}

export async function changePropertyStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(propertyStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.propertyId);
    const ref = propertyRef(before);
    requirePermission(ctx, input.status === "withdrawn" ? "property.delete" : "property.update", ref);
    if (!canTransitionProperty(before.status, input.status)) {
      throw new ConflictError(
        `No se puede pasar de ${PROPERTY_STATUS_LABELS[before.status]} a ${PROPERTY_STATUS_LABELS[input.status]}`,
      );
    }
    if (input.status === "published") {
      const missing = await checklistFor(tx, before);
      if (missing.length)
        throw new ValidationError(`Para publicar falta: ${missing.join(", ")}`, { status: missing });
    }
    const now = new Date();
    const [after] = await tx
      .update(property)
      .set({
        status: input.status,
        statusChangedAt: now,
        ...(input.status === "published" && !before.publishedAt ? { publishedAt: now } : {}),
      })
      .where(eq(property.id, before.id))
      .returning();

    // La captación asociada pasa a "Publicado" cuando se publica la propiedad.
    if (input.status === "published") {
      const moved = await tx
        .update(acquisition)
        .set({ stage: "published", stageChangedAt: now })
        .where(and(eq(acquisition.propertyId, before.id), eq(acquisition.stage, "captured")))
        .returning({ id: acquisition.id });
      for (const a of moved) {
        await writeAudit(tx, ctx, {
          action: "acquisition.stage_change",
          entityType: "acquisition",
          entityId: a.id,
          before: { stage: "captured" },
          after: { stage: "published", automatic: true },
        });
      }
    }
    await syncPublicationsWithStatus(tx, before.id, input.status);
    await syncPropertySearch(tx, [before.id]);
    await writeAudit(tx, ctx, {
      action: "property.status_change",
      entityType: "property",
      entityId: before.id,
      before: { status: before.status },
      after: { status: input.status, note: input.note },
    });
    await emitEvent(tx, ctx, {
      type: "property.status_changed",
      aggregateType: "property",
      aggregateId: before.id,
      payload: { from: before.status, to: input.status },
    });
    return after;
  });
}

/**
 * Precios por operación. Cada cambio de cada campo queda en el historial (append-only).
 * El mínimo autorizado solo lo ve y lo cambia quien tiene `property.price.floor.read`.
 */
export async function setPrices(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(setPricesSchema, rawInput);
  return db.transaction(async (tx) => {
    const p = await loadForWrite(tx, ctx, input.propertyId);
    const ref = propertyRef(p);
    requirePermission(ctx, "property.price.update", ref);
    const canFloor = hasPermission(ctx, "property.price.floor.read", ref);
    const current = await tx.select().from(propertyPrice).where(eq(propertyPrice.propertyId, p.id));
    const changes: {
      operation: PropertyOperation;
      field: PriceField;
      currency: Currency;
      old: bigint | null;
      next: bigint | null;
    }[] = [];

    for (const pr of input.prices) {
      if (!p.operations.includes(pr.operation)) {
        throw new ValidationError("La propiedad no se ofrece en esa operación", {
          prices: ["Operación no habilitada"],
        });
      }
      const prev = current.find((c) => c.operation === pr.operation);
      const minor = (v: string | null) => (v ? parseMoney(v, pr.currency).amountMinor : null);
      const next = {
        list: minor(pr.list),
        owner_asking: minor(pr.ownerAsking),
        minimum: canFloor ? minor(pr.minimum) : (prev?.minimumMinor ?? null),
      };
      if (prev && prev.currency !== pr.currency) {
        // Cambio de moneda: todos los campos cambian de significado; se registra cada uno.
        for (const field of ["list", "owner_asking", "minimum"] as const) {
          const old =
            field === "list"
              ? prev.listMinor
              : field === "owner_asking"
                ? prev.ownerAskingMinor
                : prev.minimumMinor;
          if (old !== null)
            changes.push({ operation: pr.operation, field, currency: prev.currency, old, next: null });
        }
      }
      for (const field of ["list", "owner_asking", "minimum"] as const) {
        const old =
          prev && prev.currency === pr.currency
            ? field === "list"
              ? prev.listMinor
              : field === "owner_asking"
                ? prev.ownerAskingMinor
                : prev.minimumMinor
            : null;
        if (old !== next[field])
          changes.push({ operation: pr.operation, field, currency: pr.currency, old, next: next[field] });
      }
      await tx
        .insert(propertyPrice)
        .values({
          propertyId: p.id,
          operation: pr.operation,
          currency: pr.currency,
          listMinor: next.list,
          ownerAskingMinor: next.owner_asking,
          minimumMinor: next.minimum,
        })
        .onConflictDoUpdate({
          target: [propertyPrice.propertyId, propertyPrice.operation],
          set: {
            currency: pr.currency,
            listMinor: next.list,
            ownerAskingMinor: next.owner_asking,
            minimumMinor: next.minimum,
          },
        });
    }

    if (changes.length) {
      await tx.insert(propertyPriceHistory).values(
        changes.map((c) => ({
          organizationId: ctx.organizationId,
          propertyId: p.id,
          operation: c.operation,
          field: c.field,
          currency: c.currency,
          oldMinor: c.old,
          newMinor: c.next,
          reason: input.reason,
          changedById: ctx.userId,
        })),
      );
      await writeAudit(tx, ctx, {
        action: "property.price_change",
        entityType: "property",
        entityId: p.id,
        before: changes.map((c) => ({
          operation: c.operation,
          field: c.field,
          currency: c.currency,
          value: c.old,
        })),
        after: changes.map((c) => ({
          operation: c.operation,
          field: c.field,
          currency: c.currency,
          value: c.next,
        })),
      });
      const reductions = changes.filter(
        (c) => c.field === "list" && c.old !== null && c.next !== null && c.next < c.old,
      );
      await emitEvent(tx, ctx, {
        type: reductions.length ? "property.price_reduced" : "property.price_changed",
        aggregateType: "property",
        aggregateId: p.id,
        payload: {
          changes: changes
            .filter((c) => c.field === "list")
            .map((c) => ({ operation: c.operation, old: c.old, next: c.next })),
        },
      });
      await syncPropertySearch(tx, [p.id]);
    }
    return { changed: changes.length };
  });
}

/**
 * Propietarios con participación. Deben sumar 100 %; cada contacto debe ser visible para quien
 * edita. Asociar un contacto como dueño lo registra como propietario (owner_profile).
 */
export async function setPropertyOwners(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(setOwnersSchema, rawInput);
  return db.transaction(async (tx) => {
    const p = await loadForWrite(tx, ctx, input.propertyId);
    requirePermission(ctx, "property.update", propertyRef(p));
    const ids = input.owners.map((o) => o.contactId);
    const contacts = ids.length
      ? await tx
          .select()
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, ctx.organizationId),
              inArray(contact.id, ids),
              isNull(contact.deletedAt),
            ),
          )
      : [];
    if (contacts.length !== ids.length)
      throw new ValidationError("Uno de los propietarios no existe", { owners: ["Contacto inválido"] });
    for (const c of contacts) {
      if (
        !hasPermission(ctx, "owner.read", contactRef(c)) &&
        !hasPermission(ctx, "contact.read", contactRef(c))
      ) {
        throw new ForbiddenError("No podés asociar un contacto que no podés ver");
      }
    }

    const before = await tx.select().from(propertyOwner).where(eq(propertyOwner.propertyId, p.id));
    await tx.delete(propertyOwner).where(eq(propertyOwner.propertyId, p.id));
    if (input.owners.length) {
      await tx.insert(propertyOwner).values(
        input.owners.map((o) => ({
          propertyId: p.id,
          contactId: o.contactId,
          organizationId: ctx.organizationId,
          shareBasisPoints: parsePercentToBasisPoints(o.sharePercent ?? "0"),
        })),
      );
      for (const c of contacts) {
        const inserted = await tx
          .insert(ownerProfile)
          .values({ contactId: c.id, organizationId: ctx.organizationId })
          .onConflictDoNothing()
          .returning({ id: ownerProfile.contactId });
        if (!before.some((b) => b.contactId === c.id)) {
          await logActivity(tx, ctx, {
            type: "owner_updated",
            contactId: c.id,
            body: `${inserted.length ? "Registrado como propietario de" : "Asociado como propietario de"} ${p.code}`,
            payload: { propertyId: p.id, code: p.code },
          });
        }
      }
    }
    await writeAudit(tx, ctx, {
      action: "property.owner_change",
      entityType: "property",
      entityId: p.id,
      before: before.map((b) => ({ contactId: b.contactId, shareBasisPoints: b.shareBasisPoints })),
      after: input.owners.map((o) => ({ contactId: o.contactId, sharePercent: o.sharePercent })),
    });
    await emitEvent(tx, ctx, {
      type: "property.owners_changed",
      aggregateType: "property",
      aggregateId: p.id,
    });
  });
}

export async function listProperties(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "property.read");
  const q = parseInput(propertyListSchema, rawQuery);
  const conditions: (SQL | undefined)[] = [
    eq(property.organizationId, ctx.organizationId),
    isNull(property.deletedAt),
    scopeCondition(ctx, "property.read", {
      ownerUserId: property.assignedUserId,
      branchId: property.branchId,
      teamId: property.teamId,
    }),
  ];
  if (q.status === "active") conditions.push(inArray(property.status, [...ACTIVE_PROPERTY_STATUSES]));
  else if (q.status) conditions.push(eq(property.status, q.status));
  if (q.operation) conditions.push(sql`${q.operation}::property_operation = any(${property.operations})`);
  if (q.type) conditions.push(eq(property.type, q.type));
  if (q.localityId) conditions.push(eq(property.localityId, q.localityId));
  if (q.assignedUserId) conditions.push(eq(property.assignedUserId, q.assignedUserId));
  if (q.ownerContactId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(propertyOwner)
          .where(
            and(eq(propertyOwner.propertyId, property.id), eq(propertyOwner.contactId, q.ownerContactId)),
          ),
      ),
    );
  }
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      or(
        sql`lower(${property.code}) like ${term}`,
        sql`lower(unaccent(coalesce(${property.title}, ''))) like ${term}`,
        sql`lower(unaccent(coalesce(${property.address}, ''))) like ${term}`,
        sql`lower(unaccent(coalesce(${neighborhood.name}, ''))) like ${term}`,
        sql`lower(unaccent(coalesce(${locality.name}, ''))) like ${term}`,
      ),
    );
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: property.id,
        code: property.code,
        type: property.type,
        title: property.title,
        status: property.status,
        operations: property.operations,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        builtArea: property.builtArea,
        totalArea: property.totalArea,
        address: property.address,
        updatedAt: property.updatedAt,
        localityName: locality.name,
        neighborhoodName: neighborhood.name,
        assignedName: user.name,
      })
      .from(property)
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .leftJoin(user, eq(user.id, property.assignedUserId))
      .where(where)
      .orderBy(desc(property.updatedAt), desc(property.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: count() })
      .from(property)
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const [prices, covers] = ids.length
    ? await Promise.all([
        db
          .select({
            propertyId: propertyPrice.propertyId,
            operation: propertyPrice.operation,
            currency: propertyPrice.currency,
            listMinor: propertyPrice.listMinor,
          })
          .from(propertyPrice)
          .where(inArray(propertyPrice.propertyId, ids)),
        db
          .select({ propertyId: propertyMedia.propertyId, id: propertyMedia.id })
          .from(propertyMedia)
          .where(and(inArray(propertyMedia.propertyId, ids), eq(propertyMedia.isCover, true))),
      ])
    : [[], []];

  return {
    items: rows.map((r) => ({
      ...r,
      displayTitle: propertyDisplayTitle(r),
      prices: prices.filter((pr) => pr.propertyId === r.id && pr.listMinor !== null),
      coverMediaId: covers.find((c) => c.propertyId === r.id)?.id ?? null,
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Ficha completa de la propiedad, con datos sensibles filtrados según permisos. */
export async function getProperty(db: DbOrTx, ctx: RequestContext, propertyId: string) {
  const id = parseInput(uuidSchema, propertyId);
  const [row] = await db
    .select({
      p: property,
      departmentName: department.name,
      localityName: locality.name,
      neighborhoodName: neighborhood.name,
      assignedName: user.name,
    })
    .from(property)
    .leftJoin(department, eq(department.id, property.departmentId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .leftJoin(user, eq(user.id, property.assignedUserId))
    .where(
      and(eq(property.id, id), eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt)),
    );
  if (!row) throw new NotFoundError("Propiedad");
  const ref = propertyRef(row.p);
  if (!hasPermission(ctx, "property.read", ref)) throw new NotFoundError("Propiedad");
  const canFloor = hasPermission(ctx, "property.price.floor.read", ref);

  const [prices, expenses, owners, media, acquisitions, valuations, captador] = await Promise.all([
    db
      .select()
      .from(propertyPrice)
      .where(eq(propertyPrice.propertyId, id))
      .orderBy(asc(propertyPrice.operation)),
    db.select().from(propertyExpense).where(eq(propertyExpense.propertyId, id)),
    db
      .select({ o: propertyOwner, c: contact })
      .from(propertyOwner)
      .innerJoin(contact, eq(contact.id, propertyOwner.contactId))
      .where(eq(propertyOwner.propertyId, id))
      .orderBy(desc(propertyOwner.shareBasisPoints)),
    db
      .select()
      .from(propertyMedia)
      .where(eq(propertyMedia.propertyId, id))
      .orderBy(asc(propertyMedia.position)),
    db
      .select({
        id: acquisition.id,
        code: acquisition.code,
        stage: acquisition.stage,
        exclusive: acquisition.exclusive,
        exclusiveUntil: acquisition.exclusiveUntil,
      })
      .from(acquisition)
      .where(and(eq(acquisition.propertyId, id), isNull(acquisition.deletedAt))),
    db.select({ n: count() }).from(valuation).where(eq(valuation.propertyId, id)),
    row.p.captadorUserId
      ? db.select({ name: user.name }).from(user).where(eq(user.id, row.p.captadorUserId))
      : Promise.resolve([]),
  ]);

  const ownerViews = owners.map(({ o, c }) => ({
    contactId: c.id,
    displayName: c.displayName,
    shareBasisPoints: o.shareBasisPoints,
    visible:
      hasPermission(ctx, "owner.read", contactRef(c)) || hasPermission(ctx, "contact.read", contactRef(c)),
  }));

  return {
    property: row.p,
    displayTitle: propertyDisplayTitle(row.p),
    zone: { department: row.departmentName, locality: row.localityName, neighborhood: row.neighborhoodName },
    assignedName: row.assignedName,
    captadorName: captador[0]?.name ?? null,
    prices: prices.map((pr) => ({
      ...pr,
      minimumMinor: canFloor ? pr.minimumMinor : null,
      minimumHidden: !canFloor && pr.minimumMinor !== null,
    })),
    expenses,
    owners: ownerViews.map((v) => ({
      contactId: v.visible ? v.contactId : null,
      displayName: v.visible ? v.displayName : "Propietario (restringido)",
      shareBasisPoints: v.shareBasisPoints,
    })),
    // Para editar propietarios se necesitan los ids reales: solo se entregan a quien puede editar
    // la propiedad Y ver a todos sus propietarios (si no, el editor filtraría datos restringidos).
    ownerIdsForEdit:
      hasPermission(ctx, "property.update", ref) && ownerViews.every((v) => v.visible)
        ? ownerViews.map((v) => ({
            contactId: v.contactId,
            displayName: v.displayName,
            shareBasisPoints: v.shareBasisPoints,
          }))
        : null,
    media,
    acquisitions,
    valuationCount: valuations[0]?.n ?? 0,
    checklist: await checklistFor(db, row.p),
    permissions: {
      update: hasPermission(ctx, "property.update", ref),
      withdraw: hasPermission(ctx, "property.delete", ref),
      priceUpdate: hasPermission(ctx, "property.price.update", ref),
      priceFloor: canFloor,
      valuationManage: hasPermission(ctx, "valuation.manage", ref),
      documentManage: hasPermission(ctx, "document.manage", ref),
      assign: (() => {
        const s = widestScope(ctx.grants, "property.update");
        return !!s && SCOPE_RANK[s] > SCOPE_RANK.own;
      })(),
    },
  };
}

/** Historial de precios visible para el usuario (sin el mínimo si no tiene permiso). */
export async function listPriceHistory(db: DbOrTx, ctx: RequestContext, propertyId: string) {
  const id = parseInput(uuidSchema, propertyId);
  const [p] = await db
    .select()
    .from(property)
    .where(and(eq(property.id, id), eq(property.organizationId, ctx.organizationId)));
  if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
  const canFloor = hasPermission(ctx, "property.price.floor.read", propertyRef(p));
  const rows = await db
    .select({ h: propertyPriceHistory, actorName: user.name })
    .from(propertyPriceHistory)
    .leftJoin(user, eq(user.id, propertyPriceHistory.changedById))
    .where(eq(propertyPriceHistory.propertyId, id))
    .orderBy(desc(propertyPriceHistory.changedAt))
    .limit(200);
  return rows
    .filter((r) => canFloor || r.h.field !== "minimum")
    .map((r) => ({ ...r.h, actorName: r.actorName }));
}

/**
 * Historial de la propiedad (estado, datos, propietarios) a partir de la auditoría, sin exponer
 * valores: solo qué pasó, quién y cuándo. Los montos están en el historial de precios.
 */
export async function listPropertyHistory(db: DbOrTx, ctx: RequestContext, propertyId: string) {
  const id = parseInput(uuidSchema, propertyId);
  const [p] = await db
    .select()
    .from(property)
    .where(and(eq(property.id, id), eq(property.organizationId, ctx.organizationId)));
  if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      after: auditLog.after,
      before: auditLog.before,
      createdAt: auditLog.createdAt,
      actorName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.organizationId, ctx.organizationId),
        eq(auditLog.entityType, "property"),
        eq(auditLog.entityId, id),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);
  return rows.map((r) => {
    const status =
      r.action === "property.status_change"
        ? {
            from: (r.before as { status?: string } | null)?.status ?? null,
            to: (r.after as { status?: string } | null)?.status ?? null,
            note: (r.after as { note?: string } | null)?.note ?? null,
          }
        : null;
    return { id: r.id, action: r.action, createdAt: r.createdAt, actorName: r.actorName, status };
  });
}

/** Propiedades de un propietario (para su ficha). */
export async function listOwnerProperties(db: DbOrTx, ctx: RequestContext, contactId: string) {
  const id = parseInput(uuidSchema, contactId);
  if (!hasPermission(ctx, "property.read")) return [];
  const rows = await db
    .select({ p: property, share: propertyOwner.shareBasisPoints })
    .from(propertyOwner)
    .innerJoin(property, eq(property.id, propertyOwner.propertyId))
    .where(
      and(
        eq(propertyOwner.contactId, id),
        eq(property.organizationId, ctx.organizationId),
        isNull(property.deletedAt),
      ),
    )
    .orderBy(asc(property.code));
  return rows
    .filter((r) => hasPermission(ctx, "property.read", propertyRef(r.p)))
    .map((r) => ({
      id: r.p.id,
      code: r.p.code,
      displayTitle: propertyDisplayTitle(r.p),
      status: r.p.status,
      shareBasisPoints: r.share,
    }));
}

export async function propertyStats(db: DbOrTx, ctx: RequestContext) {
  if (!hasPermission(ctx, "property.read")) return null;
  const scope = scopeCondition(ctx, "property.read", {
    ownerUserId: property.assignedUserId,
    branchId: property.branchId,
    teamId: property.teamId,
  });
  const rows = await db
    .select({ status: property.status, n: count() })
    .from(property)
    .where(and(eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt), scope))
    .groupBy(property.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<(typeof rows)[number]["status"], number>
  >;
}
