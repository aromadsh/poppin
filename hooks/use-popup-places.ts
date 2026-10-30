"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PopupPlacesController } from "../lib/place-input";

export function usePopupPlaces(dateFrom: string, dateTo: string) {
  const [controller] = useState(() => new PopupPlacesController(dateFrom, dateTo));
  const places = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.activate(); return controller.deactivate; }, [controller]);
  useEffect(() => { controller.setDates(dateFrom, dateTo); }, [controller, dateFrom, dateTo]);
  return { places, addPlace: controller.addPlace, removePlace: controller.removePlace, updatePlace: controller.updatePlace, lookupNow: controller.lookupNow, selectCandidate: controller.selectCandidate, resolvePlaces: controller.resolvePlaces, setComposing: controller.setComposing };
}
