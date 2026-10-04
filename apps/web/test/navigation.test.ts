import { describe, expect, it } from "vitest";
import { isPermissionCode } from "@crm/shared/rbac";
import { t, type MessageKey } from "../lib/i18n";
import { findNavItem, NAVIGATION } from "../lib/navigation";

describe("navegación", () => {
  const items = NAVIGATION.flatMap((s) => [
    ...(s.href && s.permission ? [{ href: s.href, permission: s.permission, label: s.label }] : []),
    ...(s.items ?? []),
  ]);

  it("cada entrada usa un permiso del catálogo y tiene texto traducido", () => {
    for (const item of items) {
      expect(isPermissionCode(item.permission), item.href).toBe(true);
      expect(t(item.label as MessageKey)).not.toBe("");
    }
  });

  it("las rutas son únicas", () => {
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("encuentra módulos planificados y su fase", () => {
    expect(findNavItem("/properties")?.item.plannedPhase).toBeNull();
    expect(findNavItem("/properties/publications")?.item.plannedPhase).toBeNull();
    expect(findNavItem("/finance/reports")?.item.plannedPhase).toBe(13);
    expect(findNavItem("/crm/leads")?.item.plannedPhase).toBeNull();
    expect(findNavItem("/admin/users")?.item.plannedPhase).toBeNull();
    expect(findNavItem("/no-existe")).toBeNull();
  });
});
