"use client";

import type { DynamicChartData } from "@/lib/queries/dynamic";
import { TrendChart } from "./trend";
import { ComparisonChart } from "./comparison";
import { DistributionChart } from "./distribution";
import { CalendarChart } from "./calendar";
import { ScatterChartDynamic } from "./scatter";
import { StackedChart } from "./stacked";

/**
 * Switch dispatcher: same shape as Rize's `chart-factory.tsx`. The data
 * already arrived shaped per spec — this picks the right viz by chart_type.
 */
export function DynamicChartFactory({
  data,
  height,
}: {
  data: DynamicChartData;
  height?: number;
}) {
  switch (data.spec.chart_type) {
    case "trend":
      return <TrendChart data={data} height={height} />;
    case "comparison":
      return <ComparisonChart data={data} height={height} />;
    case "distribution":
      return <DistributionChart data={data} height={height} />;
    case "calendar":
      return <CalendarChart data={data} />;
    case "scatter":
      return <ScatterChartDynamic data={data} height={height} />;
    case "stacked":
      return <StackedChart data={data} height={height} />;
    default:
      return null;
  }
}
