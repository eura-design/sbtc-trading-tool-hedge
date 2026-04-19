import { useTheme } from "../ThemeContext";

export function Divider() {
  const { theme } = useTheme();
  return <div style={{ height:"1px", background:theme.border, margin:"12px 0" }} />;
}
