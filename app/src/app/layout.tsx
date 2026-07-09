import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "KnowBreak Review Studio",
  description: "Script / storyboard / image review console for KnowBreak workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
