/** prox mark: an arrow with speed lines on a dark rounded tile. */
export function ProxLogo({ size = 34 }: { size?: number }) {
  return (
    <svg
      className="sidebar-brand-logo prox-logo"
      width={size}
      height={size}
      viewBox="0 0 34 34"
      role="img"
      aria-label="prox"
    >
      <rect width="34" height="34" rx="9" fill="#1c1c1f" />
      <path d="M6 13h9" stroke="#f5f5f5" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 18h7" stroke="#f5f5f5" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M6 23h9" stroke="#f5f5f5" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M15 9.5 27 17 15 24.5"
        fill="none"
        stroke="#f59e3b"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
