import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
    metadataBase: new URL("https://poppin-pp.royalbee2048.chatgpt.site"),
    title: "PopPin | 나에게 맞는 팝업 방문 타이밍",
    description: "공개 후기와 행사 정보를 바탕으로 날짜, 시간대, 방문 경로를 계획하세요. 로그인 없이 시작하는 나만의 팝업 플래너.",
    openGraph: { title: "PopPin · 기다림은 짧게, 좋아하는 순간은 길게.", description: "공개 정보와 내 일정으로 찾는 팝업 방문 타이밍", images: ["/og.png"], locale: "ko_KR", type: "website" },
    twitter: { card: "summary_large_image", title: "PopPin | 나에게 맞는 팝업 방문 타이밍", images: ["/og.png"] },
    robots: { index: true, follow: true },
    icons: {
        icon: "/favicon.svg",
        shortcut: "/favicon.svg",
    },
};
export default function RootLayout({ children, }: Readonly<{
    children: React.ReactNode;
}>) {
    return (<html lang="ko">
      <body className="antialiased">{children}</body>
    </html>);
}
