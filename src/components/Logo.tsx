import { useId } from 'react'

// Brand mark: a cookie with a bite taken out and a sparkle. Mirrors public/favicon.svg (see scripts/munch-mark.mjs).
export default function Logo({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Munch">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6a4cf5" />
          <stop offset=".55" stopColor="#c04df0" />
          <stop offset="1" stopColor="#ff5c9d" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx=".3" cy=".18" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#ffd6e8" />
        </linearGradient>
        <mask id={`${id}cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="39.5" cy="16.5" r="6.4" />
          <circle cx="47.6" cy="22.2" r="6.6" />
          <circle cx="51.2" cy="31.2" r="6.2" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}bg)`} />
      <rect width="64" height="64" rx="15" fill={`url(#${id}glow)`} />
      <circle cx="30" cy="37.2" r="19" fill="#3a1190" opacity=".25" mask={`url(#${id}cut)`} />
      <circle cx="30" cy="35" r="19" fill={`url(#${id}fill)`} mask={`url(#${id}cut)`} />
      <g fill="#6a3fd8">
        <circle cx="22.5" cy="29.5" r="2.7" />
        <circle cx="31.2" cy="42.8" r="3" />
        <circle cx="38.5" cy="36.2" r="2.4" />
        <circle cx="21.5" cy="41" r="2.1" />
      </g>
      <path className="logo-spark" d="M50.5 6.2l1.7 4.1 4.1 1.7-4.1 1.7-1.7 4.1-1.7-4.1-4.1-1.7 4.1-1.7z" fill="#fff" />
    </svg>
  )
}
