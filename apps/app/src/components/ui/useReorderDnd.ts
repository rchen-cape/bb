import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEventHandler,
} from "react";
import {
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type MeasuringConfiguration,
  type Modifier,
  type Sensor,
  type TouchSensorOptions,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  useDragClickSuppression,
  type ConsumeDragClickSuppression,
} from "@/components/ui/use-drag-click-suppression";

export const reorderCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const restrictDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const REORDER_MODIFIERS: Modifier[] = [restrictDragToVerticalAxis];

/**
 * How far the pointer may travel with the button down before the press counts
 * as a drag rather than a click. Every pixel of this budget is a click the user
 * can lose: crossing it starts a drag, and a drag swallows the click that the
 * browser fires on release.
 */
const DEFAULT_MOUSE_ACTIVATION_DISTANCE_PX = 4;

export interface UseReorderDndArgs {
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragMove?: (event: DragMoveEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragCancel?: () => void;
  collisionDetection?: CollisionDetection;
  touchSensor?: Sensor<TouchSensorOptions>;
  axis?: "vertical" | "free";
  measuring?: MeasuringConfiguration;
  /**
   * Overrides {@link DEFAULT_MOUSE_ACTIVATION_DISTANCE_PX}. Raise it on
   * surfaces where a click is the primary action and dragging is occasional,
   * so ordinary hand drift during a click does not read as a drag.
   */
  mouseActivationDistance?: number;
}

export type ReorderDndContextProps = Pick<
  DndContextProps,
  | "sensors"
  | "collisionDetection"
  | "onDragStart"
  | "onDragMove"
  | "onDragOver"
  | "onDragCancel"
  | "onDragEnd"
  | "modifiers"
  | "measuring"
>;

export interface UseReorderDndResult {
  dndContextProps: ReorderDndContextProps;
  consumeClickSuppression: ConsumeDragClickSuppression;
  onClickCapture: MouseEventHandler<HTMLElement>;
}

export function useReorderDnd({
  onDragEnd,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  collisionDetection = reorderCollisionDetection,
  touchSensor = TouchSensor,
  axis = "vertical",
  measuring,
  mouseActivationDistance = DEFAULT_MOUSE_ACTIVATION_DISTANCE_PX,
}: UseReorderDndArgs): UseReorderDndResult {
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const isDraggingRef = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: mouseActivationDistance },
    }),
    useSensor(touchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      isDraggingRef.current = true;
      beginDragClickSuppression();
      onDragStart?.(event);
    },
    [beginDragClickSuppression, onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }
    isDraggingRef.current = false;
    clearDragClickSuppressionSoon();
    onDragCancel?.();
  }, [clearDragClickSuppressionSoon, onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      clearDragClickSuppressionSoon();
      onDragEnd(event);
    },
    [clearDragClickSuppressionSoon, onDragEnd],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape") {
        handleDragCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      isDraggingRef.current = false;
    };
  }, [handleDragCancel]);
  const onClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );
  const dndContextProps = useMemo<ReorderDndContextProps>(
    () => ({
      sensors,
      collisionDetection,
      measuring,
      modifiers: axis === "vertical" ? REORDER_MODIFIERS : [],
      onDragStart: handleDragStart,
      onDragMove,
      onDragOver,
      onDragCancel: handleDragCancel,
      onDragEnd: handleDragEnd,
    }),
    [
      axis,
      collisionDetection,
      handleDragCancel,
      handleDragEnd,
      handleDragStart,
      measuring,
      onDragMove,
      onDragOver,
      sensors,
    ],
  );

  return {
    dndContextProps,
    consumeClickSuppression: consumeDragClickSuppression,
    onClickCapture,
  };
}
