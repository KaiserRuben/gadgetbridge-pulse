import { getTargets } from "@/lib/nutrition/data";
import { readFoodCacheStats } from "@/lib/data/meal-store";
import TargetsView from "./targets-view";

export const dynamic = "force-dynamic";

export default function NutritionTargetsPage() {
  return <TargetsView targets={getTargets()} foodCacheStats={readFoodCacheStats()} />;
}
