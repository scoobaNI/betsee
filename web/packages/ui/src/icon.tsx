import { Icon as IconifyIcon } from "@iconify/react/dist/offline";
import collections from "./icons.json";
import type { IconifyIcon as IconData } from "@iconify/react";

const icons = new Map<string, IconData>();
for (const collection of collections) {
  for (const [name, icon] of Object.entries(collection.icons)) {
    icons.set(`${collection.prefix}:${name}`, {
      ...icon,
      width: collection.width,
      height: collection.height,
    });
  }
}

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className = "" }: IconProps) {
  const icon = icons.get(name);
  if (!icon) throw new Error(`Icon is not in the offline subset: ${name}`);
  return (
    <IconifyIcon
      icon={icon}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    />
  );
}
