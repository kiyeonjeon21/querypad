import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
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
  title: "QueryPad — SQL Playground for Your Data Files",
  description:
    "Drop Parquet, CSV, or JSON files and query them with SQL in your browser. Share data + query in a single URL.",
  metadataBase: new URL("https://querypad.io"),
  openGraph: {
    title: "QueryPad",
    description: "SQL playground for Parquet/CSV/JSON — powered by DuckDB-Wasm",
    siteName: "QueryPad",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "QueryPad",
    description: "Drop a file. Query with SQL. Visualize and share. All in your browser.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
