import type { z } from "zod";

/**
 * Errores de dominio tipados. La capa web los traduce a respuestas/toasts; nunca se
 * exponen trazas ni mensajes internos de la base al usuario.
 */
export abstract class AppError extends Error {
  abstract readonly code:
    "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMITED";
}

export class UnauthenticatedError extends AppError {
  readonly code = "UNAUTHENTICATED" as const;
  constructor(message = "Sesión no válida") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "No tenés permiso para realizar esta acción") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  constructor(what = "Registro") {
    super(`${what} no encontrado`);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
}

export class RateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  constructor(message = "Demasiados intentos. Probá de nuevo en unos minutos.") {
    super(message);
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION" as const;
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }

  static fromZod(error: z.ZodError): ValidationError {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    const first = error.issues[0]?.message ?? "Datos inválidos";
    return new ValidationError(first, fieldErrors);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Valida con Zod y lanza ValidationError. Todo servicio valida su entrada con esto. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw ValidationError.fromZod(result.error);
  return result.data;
}

/** Código Postgres de violación de unicidad. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
