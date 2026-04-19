import { create } from "zustand";
import { createServerSlice }   from "./serverSlice";
import { createSettingsSlice } from "./settingsSlice";
import { createUiSlice }       from "./uiSlice";
import { createOrderSlice }    from "./orderSlice";

export const useStore = create((...a) => ({
  ...createServerSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
  ...createOrderSlice(...a),
}));
