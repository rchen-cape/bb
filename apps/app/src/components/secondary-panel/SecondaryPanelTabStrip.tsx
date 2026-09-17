import {
  type PointerEvent as ReactPointerEvent,
  type MouseEventHandler,
  useCallback,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  verticalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { cn } from "@bb/shared-ui/lib/utils";
import { VerticalTabIcon } from "./VerticalTabIcon";
import type {
  SecondaryPanelRenderableTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelTab";

class InertTouchSensor extends TouchSensor {
  static override setup(): () => void {
    return () => {};
  }
}

export interface SecondaryPanelTabStripProps {
  activeTabId: string | null;
  tabs: readonly SecondaryPanelRenderableTab[];
  onBeginTabDrag?: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onReorderTab: SecondaryPanelTabReorderHandler;
  usesDesktopChrome: boolean;
  isPanelOpen: boolean;
}

export function SecondaryPanelTabStrip({
  activeTabId,
  tabs,
  onBeginTabDrag,
  onReorderTab,
  isPanelOpen,
}: SecondaryPanelTabStripProps) {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const dragDisabled = tabs.length < 2;
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 4 },
  });
  const touchSensor = useSensor(
    isPanelOpen && !dragDisabled ? TouchSensor : InertTouchSensor,
    { activationConstraint: { delay: 200, tolerance: 6 } },
  );
  const sensors = useSensors(mouseSensor, touchSensor);
  const tabIds = useMemo(() => tabs.map((tab) => tab.tab.id), [tabs]);
  const draggingTab =
    draggingTabId === null
      ? null
      : (tabs.find((tab) => tab.tab.id === draggingTabId) ?? null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setDraggingTabId(String(event.active.id));
      beginDragClickSuppression();
    },
    [beginDragClickSuppression],
  );
  const handleDragCancel = useCallback(() => {
    setDraggingTabId(null);
    clearDragClickSuppressionSoon();
  }, [clearDragClickSuppressionSoon]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingTabId(null);
      clearDragClickSuppressionSoon();
      if (!event.over) {
        return;
      }
      const activeTabId = String(event.active.id);
      const overTabId = String(event.over.id);
      if (activeTabId === overTabId) {
        return;
      }
      onReorderTab({ activeTabId, overTabId });
    },
    [clearDragClickSuppressionSoon, onReorderTab],
  );
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );

  return (
    <div
      data-testid="secondary-panel-tab-strip"
      onClickCapture={handleClickCapture}
      className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={verticalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortablePanelTab
              key={tab.tab.id}
              dragDisabled={dragDisabled}
              isActive={tab.tab.id === activeTabId}
              onBeginTabDrag={onBeginTabDrag}
              tab={tab}
            />
          ))}
        </SortableContext>
        {createPortal(
          <DragOverlay className="cursor-grabbing">
            {draggingTab === null ? null : (
              <PanelTab
                isActive={draggingTab.tab.id === activeTabId}
                tab={draggingTab}
              />
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}

interface SortablePanelTabProps {
  isActive: boolean;
  dragDisabled: boolean;
  onBeginTabDrag?: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  tab: SecondaryPanelRenderableTab;
}

function SortablePanelTab({
  dragDisabled,
  isActive,
  onBeginTabDrag,
  tab,
}: SortablePanelTabProps) {
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: tab.tab.id,
      disabled: dragDisabled,
    });
  const { onPointerDown: sortablePointerDown, ...sortableListeners } =
    listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "shrink-0",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
      onPointerDown={(event) => {
        onBeginTabDrag?.(tab.tab.id, event);
        sortablePointerDown?.(event);
      }}
      {...sortableListeners}
    >
      <PanelTab tab={tab} isActive={isActive} />
    </div>
  );
}

function PanelTab({
  tab,
  isActive,
}: {
  tab: SecondaryPanelRenderableTab;
  isActive: boolean;
}) {
  const title =
    tab.statusLabel === null ? tab.label : `${tab.label} (${tab.statusLabel})`;
  return (
    <VerticalTabIcon
      label={tab.label}
      leadingVisual={tab.leadingVisual}
      colorTag={tab.colorTag ?? null}
      title={title}
      isActive={isActive}
      onSelect={tab.onSelect}
      onSetColorTag={tab.onSetColorTag ?? null}
      onClose={tab.isPinned ? null : tab.onClose}
    />
  );
}
