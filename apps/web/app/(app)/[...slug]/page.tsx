import { PlannedModule } from "@/components/planned-module";

export default async function PlannedModulePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return <PlannedModule path={`/${slug.join("/")}`} />;
}
