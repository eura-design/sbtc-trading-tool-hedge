import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "./constants";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem("theme") !== "light"
  );

  const toggle = () => setIsDark(d => {
    localStorage.setItem("theme", d ? "light" : "dark");
    return !d;
  });

  return (
    <ThemeContext.Provider value={{ theme: isDark ? DARK : LIGHT, isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
