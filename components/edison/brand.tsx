type EdisonMarkProps = {
  className?: string;
  title?: string;
};

export function EdisonMark({ className = "", title }: EdisonMarkProps) {
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        className="brand-mark__crown"
        d="M12 1.45C16.53 1.45 20.2 5.12 20.2 9.65C20.2 14.9 17.25 17.85 12 17.85C6.75 17.85 3.8 14.9 3.8 9.65C3.8 5.12 7.47 1.45 12 1.45Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="brand-mark__rules"
        d="M7.85 20.55H16.15M9.35 22.85H14.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EdisonLogo() {
  return (
    <span className="brand-lockup">
      <EdisonMark />
      <span className="brand-name">edison</span>
    </span>
  );
}
