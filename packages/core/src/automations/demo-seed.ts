import { count, eq } from "drizzle-orm";
import { automationRule, organization, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { RULE_TEMPLATES } from "@crm/shared/automations";
import { getBotSettings, saveBotSettings } from "../communications/bot";
import { ctxForDemo } from "../properties/demo-seed";
import { saveRule } from "./rules";

/** Automatizaciones DEMO (a partir de las sugeridas) y el asistente virtual activo. */
export async function seedDemoAutomations(db: Db): Promise<{ skipped: boolean; rules: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(automationRule)
    .where(eq(automationRule.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, rules: 0 };
  const admin = await ctxForDemo(db, org.id, "admin");
  const keys = ["lead-notify", "lead-stale", "inquiry-reception", "contract-ending", "deal-closed"];
  let n = 0;
  for (const t of RULE_TEMPLATES.filter((x) => keys.includes(x.key))) {
    await saveRule(db, admin, {
      name: t.name,
      trigger: t.trigger,
      days: t.days ?? null,
      conditions: t.conditions,
      actions: t.actions,
    });
    n++;
  }
  const bot = await getBotSettings(db, admin);
  await saveBotSettings(db, admin, {
    enabled: true,
    greeting: bot.greeting,
    handoffMessage: bot.handoffMessage,
    faqs: bot.faqs,
  });
  return { skipped: false, rules: n };
}
