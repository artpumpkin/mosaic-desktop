import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import AuroraBackground from "@/components/AuroraBackground";
import ThemeProvider from "@/components/ThemeProvider";
import { PrivacyProvider } from "@/lib/privacy";
import Toaster from "@/components/Toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mosaic",
  description: "A personal desktop workspace for finance, health, media and everyday tools.",
  applicationName: "Mosaic",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07070b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen relative overflow-x-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          themes={["light", "dark"]}
        >
          <PrivacyProvider>
            <AuroraBackground />
            <AppShell>{children}</AppShell>
            <Toaster />
          </PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
