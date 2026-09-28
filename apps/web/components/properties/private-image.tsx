import Image from "next/image";

/**
 * Imagen privada servida por /api/media con la sesión del usuario. `unoptimized` porque el
 * optimizador de Next la pediría desde el servidor sin cookies (y la imagen ya viene
 * redimensionada y en WebP desde la subida).
 */
export function PrivateImage({
  mediaId,
  size = "thumb",
  alt,
  className,
  priority,
}: {
  mediaId: string;
  size?: "thumb" | "full";
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/api/media/${mediaId}${size === "thumb" ? "?size=thumb" : ""}`}
      alt={alt}
      fill
      unoptimized
      priority={priority}
      sizes="(max-width: 640px) 100vw, 480px"
      className={className ?? "object-cover"}
    />
  );
}
