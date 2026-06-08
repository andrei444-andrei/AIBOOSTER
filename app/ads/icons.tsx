// Lightweight inline stroke icons (no external dependency).
import type { CSSProperties, ReactNode } from "react";

type P = { size?: number; style?: CSSProperties; stroke?: number };

function Svg({
  size = 18,
  style,
  stroke = 1.8,
  children,
}: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IcHome = (p: P) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9 21v-6h6v6" />
  </Svg>
);
export const IcScript = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
);
export const IcTerminal = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </Svg>
);
export const IcBell = (p: P) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
);
export const IcClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IcDoc = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const IcMegaphone = (p: P) => (
  <Svg {...p}>
    <path d="m3 11 14-6v14L3 13Z" />
    <path d="M3 11v2a2 2 0 0 0 2 2h1v4h3v-4" />
    <path d="M20 9a3 3 0 0 1 0 6" />
  </Svg>
);
export const IcSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Svg>
);
export const IcPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IcCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5L20 6" />
  </Svg>
);
export const IcChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IcArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IcArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IcHeart = (p: P) => (
  <Svg {...p}>
    <path d="M12 20s-7-4.5-9.5-8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9.5 5.5C19 15.5 12 20 12 20Z" />
  </Svg>
);
export const IcCrop = (p: P) => (
  <Svg {...p}>
    <path d="M6 2v16h16" />
    <path d="M2 6h16v16" />
  </Svg>
);
export const IcSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <path d="m6.5 6.5 3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3" />
  </Svg>
);
export const IcWand = (p: P) => (
  <Svg {...p}>
    <path d="M5 19 17 7" />
    <path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
    <path d="M4 13l.6 1.4L6 15l-1.4.6L4 17l-.6-1.4L2 15l1.4-.6Z" />
  </Svg>
);
export const IcTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
);
export const IcClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IcImage = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </Svg>
);
export const IcGrip = (p: P) => (
  <Svg {...p} stroke={2}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </Svg>
);
export const IcZoom = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M11 8v6M8 11h6M20 20l-3.2-3.2" />
  </Svg>
);
export const IcLayers = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);
