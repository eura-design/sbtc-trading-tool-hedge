import { create } from "zustand";
import { createServerSlice }   from "./serverSlice";
import { createSettingsSlice } from "./settingsSlice";
import { createUiSlice }       from "./uiSlice";
import { createOrderSlice }    from "./orderSlice";
import { createReplaySlice }   from "./replaySlice";

export const useStore = create((...a) => ({
  ...createServerSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
  ...createOrderSlice(...a),
  ...createReplaySlice(...a),
}));
