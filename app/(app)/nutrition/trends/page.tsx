import {
  getMealsWindow,
  getTargets,
  getTodayDate,
  getWeekStrip,
} from "@/lib/nutrition/data";
import TrendsView from "./trends-view";

export const dynamic = "force-dynamic";

export default function NutritionTrendsPage() {
  const today = getTodayDate();
  // Load the widest window (90 days) so the in-page toggle has full data.
  const meals = getMealsWindow(today, 90);
  const weekStrip = getWeekStrip(today, 7);
  const targets = getTargets();
  return (
    <TrendsView
      today={today}
      meals={meals}
      weekStrip={weekStrip}
      targets={targets}
    />
  );
}
