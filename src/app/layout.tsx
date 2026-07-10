import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClawNex — One nexus. Total control.",
  description: "AI Agent Fleet Security Operations Center. ProBizSystems.",
  icons: {
    icon: "/shield.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CRIT #3 — pull the per-request nonce set by middleware so the theme
  // initializer below is allowed under the nonce-based CSP. Without this
  // attribute, the script is blocked once 'unsafe-inline' is removed.
  // Falls back to "" in places where middleware didn't run (shouldn't
  // happen in normal flows; the script just won't execute, which is OK
  // because the body's own background style is the visible default).
  const nonce = (await headers()).get("x-clawnex-nonce") ?? "";
  return (
    <html lang="en" className="dark">
      <head>
        <link href="/fonts/fonts.css" rel="stylesheet" />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: `
          (function(){
            var d=document.documentElement,b=document.body||d;
            try{
              var t=localStorage.getItem('clawnex_theme');
              if(t==='light'){
                d.style.background='#f8fafc';
                d.className='light';
                b.style.background='#f8fafc';
              }else{
                d.style.background='#04070e';
                b.style.background='#04070e';
              }
            }catch(e){
              d.style.background='#04070e';
              b.style.background='#04070e';
            }
          })();
        `}} />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#04070e" }}>
        {children}
        {/* Portal root for the global tooltip system — every <Tooltip> from
            src/components/dashboard/tooltip.tsx renders its floating content here
            via createPortal, so parent overflow:hidden containers never clip it. */}
        <div id="clawnex-tooltip-root" />
      </body>
    </html>
  );
}
