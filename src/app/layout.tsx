import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Finance Dashboard",
  description: "Investments · GST filing · Tax planning · Net worth tracking",
  manifest: "/manifest.webmanifest",
  applicationName: "pfd-saas",
  appleWebApp: {
    capable: true,
    title: "Personal Finance",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#92400e",
  width: "device-width",
  initialScale: 1,
  // Allow iOS Safari to extend the layout under the camera notch when
  // installed as a PWA. Pairs with `safe-area-inset-*` env() vars in
  // Tailwind utilities if pages opt in.
  viewportFit: "cover",
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
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
