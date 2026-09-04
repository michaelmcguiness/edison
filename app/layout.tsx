import type { Metadata } from "next";
import {
  Libre_Caslon_Display,
  Libre_Caslon_Text,
  Libre_Franklin,
} from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const newsreader = localFont({
  src: "./fonts/newsreader-roman.woff2",
  style: "normal",
  weight: "700",
  variable: "--font-newsreader",
  display: "swap",
});

const caslonDisplay = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caslon-display",
  display: "swap",
});

const caslonText = Libre_Caslon_Text({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-caslon-text",
  display: "swap",
});

const libreFranklin = Libre_Franklin({
  weight: ["400", "500", "600"],
  style: ["normal"],
  subsets: ["latin"],
  variable: "--font-libre-franklin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Edison — The world, edited for one",
  description: "A sourced daily publication composed around what is worth your time.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/brand/edison-app-icon.png",
  },
};

// Strict nonce-based CSP requires request-time rendering so Next can attach the
// per-request nonce to its framework scripts and generated style elements.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${newsreader.variable} ${caslonDisplay.variable} ${caslonText.variable} ${libreFranklin.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
