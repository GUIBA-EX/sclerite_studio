import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { tr } from "./i18n";
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
export function IconButton({
  icon: Icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      {...props}
      className={`icon-button ${className}`}
      aria-label={tr(label)}
      title={tr(props.title ?? label)}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
