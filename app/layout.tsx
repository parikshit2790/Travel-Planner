import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "RouteMosaic",
  description: "A personalized travel planning website that builds trips around the people going.",
  icons: {
    icon: [
      { url: "/public/favicon.svg", type: "image/svg+xml" },
      { url: "/public/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/public/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/public/favicon.ico",
    apple: "/public/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
