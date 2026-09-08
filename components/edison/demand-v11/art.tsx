import { useId } from "react";
import { readDemandArtDescriptor, type DemandArtDescriptor } from "@edison/contracts";

const palettes = {
  sage: { paper: "#F3F0E7", ink: "#244337", leaf: "#B8C6B0", pale: "#E6E8D8", shade: "#8DA790", accent: "#BE6D50" },
  clay: { paper: "#F3F0E7", ink: "#3D493A", leaf: "#C3C6AD", pale: "#EBE5D6", shade: "#A5AD8E", accent: "#BE6D50" },
  ink: { paper: "#F3F0E7", ink: "#244337", leaf: "#A9BCA9", pale: "#E1E6D9", shade: "#78947F", accent: "#AE6E54" },
} as const;
type Palette = (typeof palettes)[DemandArtDescriptor["palette"]];

function LivingSystem({ id, colors: c, variant }: { id: string; colors: Palette; variant: number }) {
  const cell = "M372 156C514 77 714 95 860 203C1003 309 1020 525 868 643C729 751 489 725 357 610C220 490 229 266 372 156Z";
  return <>
    <defs>
      <pattern id={`${id}-dots`} width="23" height="23" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill={c.ink} opacity=".13" /></pattern>
      <clipPath id={`${id}-cell`}><path d={cell} /></clipPath>
    </defs>
    <circle cx="319" cy="481" r="295" fill={c.pale} />
    <path d={cell} fill={c.leaf} />
    <g clipPath={`url(#${id}-cell)`}>
      <rect x="235" y="94" width="791" height="640" fill={`url(#${id}-dots)`} />
      <path d="M312 586C498 737 792 668 903 499C958 416 970 321 918 237" stroke={c.shade} strokeWidth="52" fill="none" />
      <path d="M408 186C289 286 288 450 395 542" stroke="#D8DFC9" strokeWidth="20" fill="none" />
      <g fill="#E9EBDB" stroke="#708D77" strokeWidth="2">
        <ellipse cx="384" cy="374" rx="43" ry="65" transform="rotate(-28 384 374)" /><ellipse cx="847" cy="480" rx="47" ry="68" transform="rotate(30 847 480)" />
        <circle cx="519" cy="598" r="25" /><circle cx="848" cy="286" r="22" />
      </g>
      <g transform={`rotate(${-24 + variant * 5} 640 403)`}>
        <path d="M529 170C782 269 492 373 529 452C568 535 747 524 747 643" fill="none" stroke={c.ink} strokeWidth="35" />
        <path d="M747 170C494 269 784 373 747 452C708 535 529 524 529 643" fill="none" stroke="#F0EDD9" strokeWidth="35" />
        <path d="M566 191H709M595 238H680M605 332H671M558 385H717M548 432H727M580 530H695M560 579H718" fill="none" stroke="#506F55" strokeWidth="14" strokeLinecap="round" />
        <path d="M594 282H626" stroke={c.accent} strokeWidth="18" strokeLinecap="round" /><path d="M652 282H684" stroke={c.ink} strokeWidth="18" strokeLinecap="round" />
        <path d="M529 170C626 208 644 246 637 275M531 454C568 535 747 524 747 643" fill="none" stroke={c.ink} strokeWidth="35" />
      </g>
    </g>
    <path d={cell} fill="none" stroke="#365240" strokeWidth="3" />
    <path d="M613 267C687 189 751 130 864 107" fill="none" stroke="#6B826C" strokeWidth="2" strokeDasharray="4 9" />
    <g transform={`translate(${881 - variant * 12} 90) rotate(-24)`}><rect x="-59" y="-15" width="118" height="30" rx="15" fill={c.accent} /><path d="M-18-15V15M18-15V15" stroke={c.paper} strokeWidth="3" /></g>
    <circle cx="240" cy="218" r="12" fill="#A6B89A" /><circle cx="968" cy="627" r="9" fill={c.accent} />
  </>;
}

function BuiltSpace({ id, colors: c, variant }: { id: string; colors: Palette; variant: number }) {
  return <>
    <defs><pattern id={`${id}-lines`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0V10" stroke="#315043" strokeWidth="1" opacity=".16" /></pattern></defs>
    <circle cx={928 - variant * 30} cy={183 - variant * 8} r="77" fill={c.accent} />
    <path d="M206 619L494 468L1137 628L828 788Z" fill="#CCD2BD" /><path d="M121 667L405 513M183 699L469 544M244 731L529 578" fill="none" stroke="#929D85" strokeWidth="1.5" />
    <path d="M318 234L459 155L961 277L820 356Z" fill="#D1D7BE" /><path d="M820 356L961 277V583L820 666Z" fill={c.shade} /><path d="M820 356L961 277V583L820 666Z" fill={`url(#${id}-lines)`} />
    <path d="M318 234L820 356V666L318 544Z" fill={c.leaf} /><path d="M318 234L820 356V383L318 261Z" fill="#E1E4D0" />
    <g fill={c.ink}><path d="M366 558V365C366 270 470 292 470 389V583Z" /><path d="M529 598V405C529 310 633 332 633 429V623Z" /><path d="M692 638V445C692 350 796 372 796 469V663Z" /></g>
    <g fill={c.paper}><path d="M397 566V379C397 319 449 330 449 396V578Z" /><path d="M560 606V419C560 359 612 370 612 436V618Z" /><path d="M723 646V459C723 399 775 410 775 476V658Z" /></g>
    <g fill="none" stroke="#5A785C" strokeWidth="2"><path d="M347 308L347 549M505 347L505 589M668 388L668 629" /><path d="M329 487L356 494M483 524L518 533M646 564L681 573M803 602L820 606" /></g>
    <path d="M286 536L820 666L961 583V606L820 691L286 562Z" fill="#809C82" /><path d="M254 562L820 699L990 600V620L820 724L254 587Z" fill="#B4C2A8" /><path d="M223 587L820 732L1018 616V637L820 757L223 612Z" fill="#D3DAC2" /><path d="M223 612L820 757V769L223 624Z" fill="#A0B394" />
    <g transform="translate(522 619)"><ellipse cx="1" cy="57" rx="28" ry="7" fill="#81917A" opacity=".5" /><circle cx="0" cy="0" r="9" fill={c.accent} /><path d="M-8 17Q0 10 8 17L12 40H-12Z" fill={c.ink} /><path d="M-4 39L-8 58M5 39L10 58" stroke={c.ink} strokeWidth="5" /></g>
    <path d="M152 122H272M212 62V182" stroke="#91A287" strokeWidth="1.5" /><circle cx="212" cy="122" r="4" fill="#91A287" />
  </>;
}

function Ledger({ colors: c }: { colors: Palette }) {
  return <>
    <path d="M-116-83L128-83L151 93H-93Z" fill={c.leaf} stroke="#49684D" strokeWidth="2" /><path d="M-131-96L113-96L136 80H-108Z" fill="#E4E8D5" stroke="#49684D" strokeWidth="2" />
    <path d="M-145-110H100L123 66H-122Z" fill={c.paper} stroke="#35573F" strokeWidth="3" /><path d="M-110-108L-87 64" stroke="#9BAC8C" strokeWidth="2" />
    <g fill="#35573F"><circle cx="-126" cy="-72" r="4" /><circle cx="-121" cy="-35" r="4" /><circle cx="-116" cy="2" r="4" /><circle cx="-111" cy="39" r="4" /></g>
    <path d="M-87-85H14M-84-71H-27" stroke="#35573F" strokeWidth="5" /><path d="M-88-24H83L86-4H-85Z" fill={c.accent} opacity=".66" />
    <g fill="none" stroke="#718B63" strokeWidth="2"><path d="M-81-45H84M-77-14H88M-73 17H92M-69 48H96" /><path d="M-5-54L9 53M43-54L57 53" /></g>
    <path d="M-75-51H-25M7-51H28M55-51H75M-71-20H-30M11-20H32M59-20H79M-67 11H-18M15 11H36M63 11H83M-63 42H-13M19 42H40M67 42H87" stroke="#35573F" strokeWidth="3" />
    <path d="M54-95H81L85-68H58Z" fill="none" stroke={c.accent} strokeWidth="2" /><path d="M62-80L68-75L77-87" fill="none" stroke={c.accent} strokeWidth="2" />
  </>;
}

function SharedNetwork({ id, colors: c, variant }: { id: string; colors: Palette; variant: number }) {
  return <>
    <defs><pattern id={`${id}-hatch`} width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V13" stroke="#59724E" opacity=".12" strokeWidth="2" /></pattern></defs>
    <circle cx="603" cy="414" r="288" fill={c.pale} /><circle cx="603" cy="414" r="288" fill={`url(#${id}-hatch)`} />
    <path d="M359 478C353 325 436 235 590 238M666 268C839 311 891 411 848 532M749 619C579 702 434 668 370 569" fill="none" stroke="#486B4D" strokeWidth="3" /><path d="M394 455C422 348 483 302 579 303M682 330C777 372 805 417 789 509M718 572C588 621 473 599 418 546" fill="none" stroke="#9BAC8C" strokeWidth="1.5" strokeDasharray="3 9" />
    {[[625, 208], [314, 543], [879, 555]].map(([x, y], index) => <g key={index} transform={`translate(${x} ${y}) rotate(${-12 + variant * 4})`}><Ledger colors={c} /></g>)}
    <g fill={c.accent} stroke={c.paper} strokeWidth="7"><circle cx="411" cy="316" r="14" /><circle cx="873" cy="371" r="14" /><circle cx="593" cy="651" r="14" /></g>
    <circle cx="596" cy="438" r="41" fill={c.paper} /><circle cx="596" cy="438" r="41" fill="none" stroke="#ADBA9C" strokeWidth="1.5" /><path d="M160 257h53M186.5 231v52M1002 698h53" stroke="#9BAC8C" strokeWidth="1.5" />
  </>;
}

/** Decorative artwork accompanies the headline. It supplies no claims, sources,
 * real locations or protocol diagrams. No fetch, image stage or raw SVG runs. */
export function DemandArticleArt({ descriptor, className }: { descriptor?: unknown; className?: string }) {
  // A React-owned instance ID is deterministic through SSR/hydration and avoids
  // collisions when the same saved art appears more than once in a document.
  const id = `demand-art-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const art = readDemandArtDescriptor(descriptor);
  if (!art) return null;
  const colors = palettes[art.palette];
  const props = { id, colors, variant: art.variant };
  return <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" data-editorial-art={art.composition} style={{ display: "block", width: "100%", height: "auto", aspectRatio: "3 / 2", background: colors.paper }}>
    <rect width="1200" height="800" fill={colors.paper} />
    {art.composition === "living-system" ? <LivingSystem {...props} /> : art.composition === "built-space" ? <BuiltSpace {...props} /> : <SharedNetwork {...props} />}
  </svg>;
}
