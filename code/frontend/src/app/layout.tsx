import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import ThemeToggle from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "I See I Type — Find your rhythm",
  description:
    "A calm, colorful place to practice typing, find your rhythm, and improve your speed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="appearance-init"
          strategy="beforeInteractive"
        >{`try { document.documentElement.dataset.appearance = localStorage.getItem("iseeitype-appearance") === "light" ? "light" : "dark"; } catch {}`}</Script>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
