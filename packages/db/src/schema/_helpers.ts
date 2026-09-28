import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/** UUID v7: ordenable por tiempo, bueno para índices. Se genera en la aplicación. */
export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Baja lógica: nunca se borran físicamente registros de negocio. */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

export const newId = (): string => uuidv7();
