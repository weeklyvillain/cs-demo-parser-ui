import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const FlashbangIcon: React.FC<IconProps> = ({ size = 12, color = 'currentColor', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color }}
  >
    <circle cx="8" cy="8" r="5" stroke={color} strokeWidth="2" fill="none" />
    <circle cx="8" cy="8" r="2.5" stroke={color} strokeWidth="1.5" fill={color} opacity="0.3" />
    <line x1="8" y1="3" x2="8" y2="1" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="8" y1="13" x2="8" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="3" y1="8" x2="1" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="13" y1="8" x2="15" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="5.5" y1="5.5" x2="4" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="10.5" y1="10.5" x2="12" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="10.5" y1="5.5" x2="12" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="5.5" y1="10.5" x2="4" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const MolotovIcon: React.FC<IconProps> = ({ size = 12, color = 'currentColor', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color }}
  >
    {/* Bottle body */}
    <rect x="6" y="4" width="4" height="8" rx="0.5" stroke={color} strokeWidth="2" fill="none" />
    {/* Bottle neck */}
    <rect x="7" y="2" width="2" height="2" rx="0.3" stroke={color} strokeWidth="2" fill="none" />
    {/* Flame */}
    <path
      d="M 7 4 Q 8 2 9 4 Q 8 3 7 4"
      fill={color}
      opacity="0.8"
    />
    <path
      d="M 7.5 4.5 Q 8 3 8.5 4.5"
      stroke={color}
      strokeWidth="1.5"
      fill="none"
    />
  </svg>
);

export const HEIcon: React.FC<IconProps> = ({ size = 12, color = 'currentColor', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color }}
  >
    {/* Grenade body */}
    <ellipse cx="8" cy="9" rx="4" ry="5" stroke={color} strokeWidth="2" fill="none" />
    {/* Pin */}
    <line x1="5" y1="6" x2="3" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <circle cx="3" cy="4" r="1" fill={color} />
    {/* Segments */}
    <line x1="6" y1="9" x2="10" y2="9" stroke={color} strokeWidth="1.5" />
    <line x1="7" y1="11" x2="9" y2="11" stroke={color} strokeWidth="1.5" />
  </svg>
);

export const HeadshotIcon: React.FC<IconProps> = ({ size = 12, color = 'currentColor', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color }}
  >
    {/* Outer circle */}
    <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="2" fill="none" />
    {/* Inner crosshair */}
    <circle cx="8" cy="8" r="2" stroke={color} strokeWidth="1.5" fill="none" />
    {/* Crosshair lines */}
    <line x1="8" y1="2" x2="8" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="8" y1="12" x2="8" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="2" y1="8" x2="4" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="8" x2="14" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    {/* Center dot */}
    <circle cx="8" cy="8" r="1.2" fill={color} />
  </svg>
);

export const DamageIcon: React.FC<IconProps> = ({ size = 12, color = 'currentColor', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color }}
  >
    {/* Blood drop shape */}
    <path
      d="M 8 2 Q 10 4 10 7 Q 10 10 8 12 Q 6 10 6 7 Q 6 4 8 2 Z"
      fill={color}
      opacity="0.9"
    />
    {/* Highlight */}
    <ellipse cx="7.5" cy="6" rx="1.5" ry="2" fill="white" opacity="0.3" />
  </svg>
);

