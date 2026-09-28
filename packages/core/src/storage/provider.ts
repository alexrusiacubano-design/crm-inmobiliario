import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Almacenamiento de archivos. Los archivos nunca se exponen por URL pública: se sirven a
 * través de rutas de la app que verifican sesión y permisos en cada descarga.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;

/** Claves generadas por el sistema (nunca con el nombre que sube el usuario). */
export function newStorageKey(organizationId: string, folder: string, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/g, "").slice(0, 5);
  return `${organizationId}/${folder}/${randomUUID()}${safeExt ? `.${safeExt}` : ""}`;
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Clave de almacenamiento inválida");
}

export function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Disco local: para desarrollo y tests. En serverless el disco no persiste. */
export class LocalDiskStorage implements StorageProvider {
  readonly name = "local";
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error("Ruta fuera del almacenamiento");
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/**
 * Almacenamiento compatible con S3 (Supabase Storage, Cloudflare R2, AWS S3). Usa el bucket
 * privado configurado por variables de entorno.
 */
export class S3Storage implements StorageProvider {
  readonly name = "s3";
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    options: {
      endpoint?: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error("Archivo no encontrado en el almacenamiento");
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let cached: StorageProvider | undefined;

/**
 * STORAGE_DRIVER=local (por defecto, carpeta STORAGE_LOCAL_DIR) o s3 (S3_BUCKET, S3_REGION,
 * S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY). En producción el disco local se
 * rechaza salvo que se habilite explícitamente, porque en serverless los archivos se pierden.
 */
export function getStorage(): StorageProvider {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    const { S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "Almacenamiento S3 no configurado: faltan S3_BUCKET, S3_ACCESS_KEY_ID o S3_SECRET_ACCESS_KEY",
      );
    }
    cached = new S3Storage(S3_BUCKET, {
      region: S3_REGION ?? "auto",
      endpoint: S3_ENDPOINT,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    });
    return cached;
  }
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_ALLOW_LOCAL !== "1") {
    throw new Error("En producción configurá STORAGE_DRIVER=s3 (el disco local no persiste en serverless)");
  }
  cached = new LocalDiskStorage(process.env.STORAGE_LOCAL_DIR ?? path.join(workspaceRoot(), ".storage"));
  return cached;
}

/**
 * Raíz del monorepo (donde está pnpm-workspace.yaml), para que la web, el worker y los scripts
 * compartan la misma carpeta local aunque cada uno corra desde su propio directorio.
 */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
