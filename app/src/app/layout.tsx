import type { Metadata } from "next";
import { NavigationHeader } from "@/components/navigation-header";

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
      <body>
        <NavigationHeader />
        {children}
      </body>
    </html>
  );
}

