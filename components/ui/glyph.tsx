import type { CSSProperties } from "react";
import {
  Activity, AlarmClock, AlertTriangle, ArrowRight, BarChart2, Bell, Brain, Calendar, CalendarDays, CalendarRange,
  Camera, CheckCircle, ChevronLeft, ChevronRight, Clock,
  Command, Compass, Croissant, Database, Dumbbell, Flag, Flame, FlaskConical, Footprints, Gauge, GitMerge, HeartPulse, History, Home, Hourglass, ImageOff, ImagePlus, LineChart,
  Moon, Mountain, Pause, PenLine, Plus, PowerOff, Repeat, RotateCcw, Settings, Sparkles, Sunrise, Target, Thermometer, Trash2, Trophy, Upload, User, Utensils, Waves, Wine, X, Zap, type LucideIcon,
} from "lucide-react";

const map = {
  Activity, AlarmClock, AlertTriangle, ArrowRight, BarChart2, Bell, Brain, Calendar, CalendarDays, CalendarRange,
  Camera, CheckCircle, ChevronLeft, ChevronRight, Clock,
  Command, Compass, Croissant, Database, Dumbbell, Flag, Flame, FlaskConical, Footprints, Gauge, GitMerge, HeartPulse, History, Home, Hourglass, ImageOff, ImagePlus, LineChart,
  Moon, Mountain, Pause, PenLine, Plus, PowerOff, Repeat, RotateCcw, Settings, Sparkles, Sunrise, Target, Thermometer, Trash2, Trophy, Upload, User, Utensils, Waves, Wine, X, Zap,
} satisfies Record<string, LucideIcon>;

export type GlyphName = keyof typeof map;

export function Glyph({
  name,
  size = 18,
  strokeWidth = 1.75,
  className,
  style,
}: {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = map[name];
  return <Icon size={size} strokeWidth={strokeWidth} className={className} style={style} />;
}
