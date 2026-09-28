import { char, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Catálogo geográfico global (no depende de la organización). Uruguay primero; la
 * jerarquía país → departamento → localidad → barrio sirve para otros países.
 */

export const country = pgTable("country", {
  code: char("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
});

export const department = pgTable(
  "department",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    countryCode: char("country_code", { length: 2 })
      .notNull()
      .references(() => country.code),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("department_country_name_uq").on(t.countryCode, t.name)],
);

export const locality = pgTable(
  "locality",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    departmentId: integer("department_id")
      .notNull()
      .references(() => department.id),
    name: text("name").notNull(),
  },
  (t) => [
    uniqueIndex("locality_department_name_uq").on(t.departmentId, t.name),
    index("locality_name_idx").on(t.name),
  ],
);

export const neighborhood = pgTable(
  "neighborhood",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    localityId: integer("locality_id")
      .notNull()
      .references(() => locality.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("neighborhood_locality_name_uq").on(t.localityId, t.name)],
);
