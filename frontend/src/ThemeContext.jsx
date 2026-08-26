import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "./constants";
import { lsGet, lsSet } from "./utils/storage";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(
    () => lsGet("theme") !== "light"
  );

  const toggle = () => setIsDark(d => {
    lsSet("theme", d ? "light" : "dark");
    return !d;
  });

  return (
    <ThemeContext.Provider value={{ theme: isDark ? DARK : LIGHT, isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
