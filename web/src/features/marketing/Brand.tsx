/**
 * Product logo — inline SVG so the portal has zero image requests.
 */
import React from 'react'

export const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="neom-brand-grad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#2f6fed" />
        <stop offset="0.55" stopColor="#6f5bf0" />
        <stop offset="1" stopColor="#b44df0" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#neom-brand-grad)" />
    <path
      d="M10 22.4V9.6l12 12.8V9.6"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="22" cy="22.6" r="2.1" fill="#fff" fillOpacity="0.92" />
  </svg>
)

export const BrandLock: React.FC<{ size?: number; name?: string; className?: string }> = ({
  size = 28,
  name = 'NeoM',
  className
}) => (
  <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    <BrandMark size={size} />
    <span className="p-brand-name">{name}</span>
  </span>
)

export const SunIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
)

export const MoonIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
  </svg>
)
