import "server-only";
import { NextResponse } from "next/server";

import { editMeal, readMeal, deleteMeal } from "@/lib/data/meal-store";
import type { MealComponent, NutritionFacts } from "@/lib/nutrition/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meal = readMeal(id);
  if (!meal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ meal });
}

interface EditBody {
  components?: Array<Omit<MealComponent, "id"> & { id?: string }>;
  totals?: NutritionFacts;
  diff_summary?: string;
  diff_json?: unknown;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meal = readMeal(id);
  if (!meal) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: EditBody;
  try {
    body = (await req.json()) as EditBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.components || !body.totals || !body.diff_summary) {
    return NextResponse.json(
      { error: "components, totals, diff_summary required" },
      { status: 400 },
    );
  }
  try {
    editMeal({
      id,
      components: body.components,
      totals: body.totals,
      revision: {
        by: "user",
        diff_summary: body.diff_summary,
        diff_json: body.diff_json ?? {},
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ meal: readMeal(id) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meal = readMeal(id);
  if (!meal) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteMeal(id);
  return NextResponse.json({ ok: true });
}
