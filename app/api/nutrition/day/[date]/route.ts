import "server-only";
import { NextResponse } from "next/server";

import { listMealsForPeriod } from "@/lib/data/meal-store";
import { readInsight } from "@/lib/data/period-store";
import type { NutritionDayPatternV1 } from "@/lib/types/generated";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const meals = listMealsForPeriod(date);
  const insight = readInsight<NutritionDayPatternV1>(date, "nutrition");
  return NextResponse.json({
    period_key: date,
    meals,
    day_pattern: insight?.payload ?? null,
  });
}
