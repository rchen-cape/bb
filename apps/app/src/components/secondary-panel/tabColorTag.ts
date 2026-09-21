import {
  FIXED_PANEL_TAB_COLOR_TAGS,
  type FixedPanelTabColorTag,
} from "@/lib/fixed-panel-tabs-state";

export { FIXED_PANEL_TAB_COLOR_TAGS };
export type { FixedPanelTabColorTag };

export const TAB_COLOR_TAG_SWATCH_CLASSES: Record<
  FixedPanelTabColorTag,
  string
> = {
  red: "bg-destructive",
  orange: "bg-warning",
  yellow: "bg-attention",
  green: "bg-success",
  blue: "bg-timeline-accent",
  purple: "bg-pr-merged",
};

export const TAB_COLOR_TAG_LABELS: Record<FixedPanelTabColorTag, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};
