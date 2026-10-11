import { describe, expect, it } from "vitest";
import { scorePublication } from "../src/properties/health";

const base = {
  photos: 12,
  descriptionLength: 500,
  titleLength: 40,
  hasPrice: true,
  hasArea: true,
  hasRooms: true,
  hasZone: true,
  isLand: false,
  daysPublished: 10,
};

describe("salud de publicaciones", () => {
  it("un aviso completo tiene 100 % y sin sugerencias", () => {
    expect(scorePublication(base)).toEqual({ quality: 100, tip: null });
  });

  it("sugiere lo que más suma: pocas fotos antes que descripción corta", () => {
    const r = scorePublication({ ...base, photos: 3, descriptionLength: 300 });
    expect(r.quality).toBe(73); // 100 − 22,5 (fotos) − 5 (descripción)
    expect(r.tip).toMatch(/fotos/);
  });

  it("completo pero viejo: sugiere revisar precio", () => {
    expect(scorePublication({ ...base, daysPublished: 75 }).tip).toMatch(/75 días/);
  });

  it("los terrenos no necesitan dormitorios", () => {
    expect(scorePublication({ ...base, hasRooms: false, isLand: true }).quality).toBe(100);
  });
});
