import { eq, sql } from "drizzle-orm";
import { createDb, type DbOrTx } from "../index";
import { insertCredentialUser } from "../credentials";
import { branch, membership, membershipRole, organization, user } from "../schema";
import { countGeo, ensureSystemRoles, seedGeoUruguay, syncPermissions } from "./catalog";

/**
 * Puesta en marcha de una instalación real (sin datos de demostración).
 *
 * Siempre: sincroniza permisos y el catálogo geográfico de Uruguay (idempotente).
 * Solo si la base no tiene ninguna organización real: crea la organización, una sucursal
 * y el primer usuario Super Admin con los datos de las variables SETUP_*.
 * Después de la primera vez no toca nada más, así que puede correr en cada deploy.
 */

export interface SetupInput {
  orgName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  branchName?: string;
}

function slugify(s: string): string {
  const base = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "inmobiliaria";
}

export async function setupOrganization(
  db: DbOrTx,
  input: SetupInput,
): Promise<{ created: boolean; organizationId: string }> {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.isDemo, false))
    .limit(1);
  if (existing) {
    await ensureSystemRoles(db, existing.id);
    return { created: false, organizationId: existing.id };
  }

  let slug = slugify(input.orgName);
  if (slug === "demo") slug = "inmobiliaria";
  const [taken] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug));
  if (taken) slug = `${slug}-${Date.now().toString(36)}`;

  const [org] = await db
    .insert(organization)
    .values({ name: input.orgName, slug, isDemo: false, defaultCurrency: "USD" })
    .returning({ id: organization.id });
  if (!org) throw new Error("No se pudo crear la organización");

  const roleIds = await ensureSystemRoles(db, org.id);
  const [b] = await db
    .insert(branch)
    .values({ organizationId: org.id, code: "CENTRAL", name: input.branchName?.trim() || "Casa central" })
    .returning({ id: branch.id });
  if (!b) throw new Error("No se pudo crear la sucursal");

  const email = input.adminEmail.trim().toLowerCase();
  const [prior] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const userId =
    prior?.id ??
    (await insertCredentialUser(db, { name: input.adminName, email, password: input.adminPassword })).id;

  const [m] = await db
    .insert(membership)
    .values({ organizationId: org.id, userId, defaultBranchId: b.id, jobTitle: "Super Admin" })
    .returning({ id: membership.id });
  if (!m) throw new Error("No se pudo crear la membresía");
  const roleId = roleIds.get("super_admin");
  if (!roleId) throw new Error("Rol super_admin inexistente");
  await db.insert(membershipRole).values({ organizationId: org.id, membershipId: m.id, roleId, branchId: null });

  return { created: true, organizationId: org.id };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const env = process.env;
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      if (env.SETUP_WIPE_DEMO === "1") {
        // Deja la base vacía solo si lo único que hay son datos de demostración.
        const [real] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.isDemo, false))
          .limit(1);
        if (real) {
          console.warn("SETUP_WIPE_DEMO ignorado: ya hay una organización real.");
        } else {
          // audit_log y similares son de solo inserción: sus triggers se apagan solo durante el borrado.
          await tx.execute(sql`DO $$ DECLARE t record; stmt text; BEGIN
            FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
              EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t.relname);
            END LOOP;
            SELECT 'TRUNCATE TABLE ' || string_agg(format('public.%I', c.relname), ', ') || ' RESTART IDENTITY CASCADE'
              INTO stmt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r';
            IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
            FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
              EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t.relname);
            END LOOP;
          END $$`);
          console.info("Datos de demostración borrados.");
        }
      }
      await syncPermissions(tx);
      await seedGeoUruguay(tx);
      const geo = await countGeo(tx);
      console.info(`Catálogo: ${geo.departments} departamentos, ${geo.localities} localidades.`);

      const real = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.isDemo, false));
      if (real.length > 0) {
        for (const o of real) await ensureSystemRoles(tx, o.id);
        console.info("Organización ya configurada: no se cambió nada.");
        return;
      }
      const orgName = env.SETUP_ORG_NAME?.trim() ?? "";
      const adminEmail = env.SETUP_ADMIN_EMAIL?.trim() ?? "";
      const adminPassword = env.SETUP_ADMIN_PASSWORD ?? "";
      const missing = [
        ["SETUP_ORG_NAME", orgName],
        ["SETUP_ADMIN_EMAIL", adminEmail],
        ["SETUP_ADMIN_PASSWORD", adminPassword],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) {
        console.warn(`Sin organización todavía. Para crearla configurá: ${missing.join(", ")}.`);
        return;
      }
      if (adminPassword.length < 10) {
        throw new Error("SETUP_ADMIN_PASSWORD debe tener al menos 10 caracteres");
      }
      const r = await setupOrganization(tx, {
        orgName,
        adminName: env.SETUP_ADMIN_NAME?.trim() || "Administrador",
        adminEmail,
        adminPassword,
        branchName: env.SETUP_BRANCH_NAME,
      });
      console.info(
        r.created
          ? `Organización "${orgName}" creada con el Super Admin ${adminEmail}.`
          : "Organización ya existía.",
      );
    });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]?.endsWith("setup.ts");
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
