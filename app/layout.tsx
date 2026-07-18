import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Grind", description: "Operação, faturamento, hábitos e tarefas diárias.", manifest: "/manifest.webmanifest", icons: { icon: "/grind-icon.png", apple: "/grind-icon.png" } };
export const viewport: Viewport = { themeColor: "#0b0e0d" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
