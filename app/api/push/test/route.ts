import { NextResponse } from "next/server";
import { dispatch } from "@/lib/push/dispatcher";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await dispatch({
    title: "Pulse Test",
    body: "Push funktioniert. Du wirst über morgendliche Insights, neue Workouts und Abend-Briefings informiert.",
    url: "/",
    topic: "test",
  });
  return NextResponse.json(result);
}
