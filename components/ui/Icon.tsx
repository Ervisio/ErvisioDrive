"use client";

/**
 * Thin wrapper around FontAwesomeIcon that can be used in server or client components.
 * Because FontAwesomeIcon itself uses React hooks internally it must be in a 'use client' boundary.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { SizeProp } from "@fortawesome/fontawesome-svg-core";

interface IconProps {
  icon: IconDefinition;
  className?: string;
  size?: SizeProp;
  fixedWidth?: boolean;
  spin?: boolean;
}

export function Icon({
  icon,
  className,
  size,
  fixedWidth = false,
  spin = false,
}: IconProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={className}
      size={size}
      fixedWidth={fixedWidth}
      spin={spin}
    />
  );
}
