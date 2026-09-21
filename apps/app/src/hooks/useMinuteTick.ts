import { createIntervalTick } from "./useIntervalTick";

export const useMinuteTick = createIntervalTick(60_000);
