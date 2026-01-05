import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Part Finder Agent - AI-Powered Electronic Component Search",
  description: "An autonomous AI agent that helps engineers find electronic components for their projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

