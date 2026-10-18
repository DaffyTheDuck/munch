// Brand mark: a calorie ring with a sparkle (AI) at its centre. Mirrors public/favicon.svg.
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Journable">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c4dee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#logoGrad)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="6" />
      <g transform="rotate(-100 32 32)">
        <circle className="logo-arc" cx="32" cy="32" r="18" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" pathLength={113} strokeDasharray="82 31" />
      </g>
      <path className="logo-spark" d="M32 23.5l2.7 5.8 5.8 2.7-5.8 2.7-2.7 5.8-2.7-5.8-5.8-2.7 5.8-2.7z" fill="#fff" />
    </svg>
  )
}
