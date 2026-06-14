"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { C, F, PANEL_HELP } from "../constants";
import { Dot } from "../shared";
import type { TabId } from "../types";

export function FloatingAvatar({ activeTab, tourMode, tourStep, onTourNext, onTourPrev, onTourExit, onTourRestart, visible, onClose, sharedSessionRef, sharedConnected, onSharedConnect }: {
  activeTab: TabId; tourMode: boolean; tourStep: number;
  onTourNext: () => void; onTourPrev: () => void; onTourExit: () => void; onTourRestart: () => void;
  visible: boolean; onClose: () => void;
  sharedSessionRef: React.MutableRefObject<{ session: unknown } | null>;
  sharedConnected: boolean;
  onSharedConnect: (connected: boolean) => void;
}) {
  const [pos, setPos] = useState({ x: 60, y: 100 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [minimized, setMinimized] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Use the shared session ref from parent — same session as ChatPanel
  const heygenSessionRef = sharedSessionRef;
  const heygenConnected = sharedConnected;
  const setHeygenConnected = onSharedConnect;
  const recognitionRef = useRef<unknown>(null);
  const narratedTab = useRef<string>("");
  const [tourStarted, setTourStarted] = useState(false);
  const [voiceProvider, setVoiceProvider] = useState<string>("elevenlabs");
  const [heygenLoading, setHeygenLoading] = useState(false);
  const [heygenError, setHeygenError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load voice provider setting
  useEffect(() => {
    fetch("/api/config/voice").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.settings?.voice_provider) setVoiceProvider(d.settings.voice_provider);
    }).catch(() => {});
  }, []);

  // Connect HeyGen LiveAvatar
  const connectHeygen = useCallback(async () => {
    if (heygenSessionRef.current || heygenLoading) return;
    setHeygenLoading(true); setHeygenError(null);
    try {
      const tokenRes = await fetch("/api/voice/heygen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_token" }),
      });
      if (!tokenRes.ok) throw new Error(`Token error: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      if (!tokenData.session_token) throw new Error("No session token");

      // Dynamic import of HeyGen SDK — constructor takes token as first positional arg
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { LiveAvatarSession } = await import("@heygen/liveavatar-web-sdk") as any;
      const session = new LiveAvatarSession(tokenData.session_token);

      session.on("session.stream_ready", () => {
        if (videoRef.current) {
          session.attach(videoRef.current);
          setHeygenConnected(true);
        }
      });
      session.on("session.closed", () => { setHeygenConnected(false); heygenSessionRef.current = null; });
      session.on("session.error", (err: unknown) => {
        console.error("[HeyGen] Session error:", err);
        setHeygenError(String(err));
        setHeygenConnected(false);
      });

      await session.start();
      heygenSessionRef.current = { session };
    } catch (err) {
      setHeygenError(err instanceof Error ? err.message : "Connection failed");
      setHeygenConnected(false);
    } finally { setHeygenLoading(false); }
  }, [heygenLoading]);

  // Disconnect HeyGen
  const disconnectHeygen = useCallback(() => {
    if (heygenSessionRef.current) {
      try { (heygenSessionRef.current.session as { stop: () => void; close: () => void }).stop(); } catch {}
      try { (heygenSessionRef.current.session as { close: () => void }).close(); } catch {}
      heygenSessionRef.current = null;
    }
    setHeygenConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => { return () => { disconnectHeygen(); }; }, [disconnectHeygen]);

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging]);

  // Speak function — HeyGen > ElevenLabs > Browser TTS
  const speak = useCallback(async (text: string) => {
    const clean = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]/g, "$1").replace(/[#*_`]/g, "").replace(/\n{2,}/g, ". ").replace(/\n/g, " ").trim();
    if (!clean) return;
    setSubtitle(clean.slice(0, 150) + (clean.length > 150 ? "..." : ""));

    // Try HeyGen LiveAvatar — must check heygenConnected (not just ref) to ensure session is ready
    if (heygenConnected && heygenSessionRef.current) {
      try {
        setSpeaking(true);
        const session = heygenSessionRef.current.session as { repeat: (t: string) => void };
        session.repeat(clean.slice(0, 3000));
        const words = clean.split(/\s+/).length;
        setTimeout(() => { setSpeaking(false); setSubtitle(""); }, Math.max(3000, words * 300));
        return;
      } catch (err) {
        console.error("[FloatingAvatar] HeyGen speak error:", err);
        setSpeaking(false);
        // Fall through to ElevenLabs
      }
    }

    // Try ElevenLabs — with retry on 502
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setSpeaking(true);
        const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }) });
        if (res.ok && res.headers.get("content-type")?.includes("audio")) {
          const arrayBuffer = await res.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          if (audioRef.current) audioRef.current.pause();
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { setSpeaking(false); setSubtitle(""); URL.revokeObjectURL(url); };
          audio.onerror = () => { setSpeaking(false); setSubtitle(""); URL.revokeObjectURL(url); };
          await audio.play();
          return;
        }
        if (res.status === 502 && attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        setSpeaking(false);
        break;
      } catch {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        setSpeaking(false);
        break;
      }
    }

    // Browser TTS fallback
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.0; utterance.pitch = 0.9;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => { setSpeaking(false); setSubtitle(""); };
    utterance.onerror = () => { setSpeaking(false); setSubtitle(""); };
    window.speechSynthesis.speak(utterance);
  }, [voiceProvider, heygenConnected]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    window.speechSynthesis?.cancel();
    if (heygenSessionRef.current) {
      try { (heygenSessionRef.current.session as { interrupt: () => void }).interrupt(); } catch {}
    }
    setSpeaking(false); setSubtitle("");
  }, []);

  // Auto-narrate tour text when panel changes — only after user clicks Start
  useEffect(() => {
    if (!tourMode || !tourStarted || !visible || minimized) return;
    const help = PANEL_HELP[activeTab];
    const key = `${activeTab}-${tourStep}`;
    if (narratedTab.current === key) return;
    narratedTab.current = key;
    const timer = setTimeout(() => {
      speak(`${help.title}. ${help.desc}`);
    }, 800);
    return () => clearTimeout(timer);
  }, [activeTab, tourMode, tourStarted, tourStep, visible, minimized, speak]);

  // Voice input — continuous mode so it doesn't auto-stop
  const toggleListening = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { console.warn("[FloatingAvatar] SpeechRecognition not supported"); return; }
    if (listening && recognitionRef.current) {
      try { (recognitionRef.current as { stop: () => void }).stop(); } catch {}
      setListening(false); return;
    }
    // Stop any existing recognition first
    if (recognitionRef.current) { try { (recognitionRef.current as { stop: () => void }).stop(); } catch {} }

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript || "";
      if (transcript) setInput(prev => prev + (prev ? " " : "") + transcript);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      console.warn("[FloatingAvatar] Speech recognition error:", e.error);
      if (e.error !== "no-speech") setListening(false);
    };
    recognition.onend = () => {
      // Don't auto-restart — let user click mic again
      setListening(false);
    };
    try {
      recognition.start();
      setListening(true);
    } catch (err) {
      console.error("[FloatingAvatar] Failed to start recognition:", err);
      setListening(false);
    }
  }, [listening]);

  // Ask question — sends to chat API with panel context, using the default configured model
  const askQuestion = useCallback(async (msg?: string) => {
    const text = msg || input.trim();
    if (!text || thinking) return;
    setInput(""); setThinking(true);
    stopSpeaking();
    try {
      // Read the default model from config so it matches what ChatPanel uses
      let model: string | undefined;
      let provider: string | undefined;
      try {
        const defRes = await fetch("/api/config/defaults");
        if (defRes.ok) {
          const defData = await defRes.json();
          if (defData.defaultModel) { model = defData.defaultModel.modelId; provider = defData.defaultModel.providerId; }
        }
      } catch {}
      const panelHelp = PANEL_HELP[activeTab];
      const contextNote = `[User is currently viewing the "${panelHelp.title}" panel. Panel description: ${panelHelp.desc}. Key metrics: ${panelHelp.metrics.join("; ")}]`;
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${contextNote}\n\nUser question: ${text}`, history: [], model, provider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      speak(data.content);
    } catch {
      speak("I'm sorry, I couldn't process that question. Please try again.");
    } finally { setThinking(false); }
  }, [input, thinking, activeTab, speak, stopSpeaking]);

  if (!visible) return null;

  // Minimized state — small floating button
  if (minimized) {
    return (
      <div onMouseDown={onMouseDown} style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 9999, cursor: "grab",
        width: 56, height: 56, borderRadius: "50%",
        background: `radial-gradient(circle, ${C.brand}44, ${C.bg})`,
        border: `2px solid ${speaking ? C.brand : C.brd}`,
        boxShadow: speaking ? `0 0 20px ${C.brand}44` : `0 0 8px rgba(0,0,0,0.5)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: speaking ? "pulseGlow 2s ease-in-out infinite" : "none",
      }}>
        <span style={{ fontSize: 20 }} onClick={(e) => { e.stopPropagation(); setMinimized(false); }}>
          {"\u{1F6E1}"}
        </span>
      </div>
    );
  }

  return (
    <div onMouseDown={onMouseDown} style={{
      position: "fixed", left: pos.x, top: pos.y, zIndex: 9999,
      width: 380, borderRadius: 16, overflow: "hidden",
      background: C.bgS, border: `1px solid ${speaking ? C.brand : C.brd}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.6), ${speaking ? `0 0 24px ${C.brand}33` : ""}`,
      cursor: dragging ? "grabbing" : "default",
      userSelect: "none",
    }}>
      {/* Header — drag handle */}
      <div style={{
        padding: "6px 12px", display: "flex", alignItems: "center", gap: 8,
        background: `${C.brand}10`, borderBottom: `1px solid ${C.brd}`, cursor: "grab",
      }}>
        <Dot color={speaking ? C.brand : heygenConnected ? C.green : C.txT} size={6} glow={speaking} />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.brand, fontFamily: F.mono }}>
          {speaking ? "SPEAKING" : heygenConnected ? "AVATAR LIVE" : "CLAWNEX GUIDE"}
        </span>
        {/* Tour progress — total matches the active PANEL_HELP catalog so it
            stays in sync as new panels are added (was hardcoded /19 before
            the v0.9.x configuration cards expanded the catalog to 24). */}
        {tourMode && <span style={{ fontSize: 9, color: C.cyan, fontWeight: 600 }}>TOUR {tourStep + 1}/{Object.keys(PANEL_HELP).length}</span>}
        <button onClick={(e) => { e.stopPropagation(); setMinimized(true); }} style={{ background: "none", border: "none", color: C.txT, fontSize: 14, cursor: "pointer", padding: 0 }}>{"\u2015"}</button>
        <button onClick={(e) => { e.stopPropagation(); stopSpeaking(); onClose(); }} style={{ background: "none", border: "none", color: C.txT, fontSize: 14, cursor: "pointer", padding: 0 }}>{"\u2715"}</button>
      </div>

      {/* Tour controls — positioned ABOVE avatar so they're never clipped */}
      {tourMode && (
        <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.brd}22` }}>
          {!tourStarted ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.txT, textAlign: "center" }}>Connect avatar first, then start the tour</span>
              <button onClick={(e) => { e.stopPropagation(); setTourStarted(true); narratedTab.current = ""; }} style={{
                width: "100%", padding: "8px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                background: `${C.brand}22`, border: `1px solid ${C.brand}`, color: C.brand, fontWeight: 700, fontFamily: F.mono,
              }}>Start Tour</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <button disabled={tourStep === 0} onClick={(e) => { e.stopPropagation(); stopSpeaking(); onTourPrev(); }} style={{
                flex: 1, padding: "4px", fontSize: 10, borderRadius: 4, cursor: tourStep === 0 ? "default" : "pointer",
                background: "transparent", border: `1px solid ${C.brd}`, color: tourStep === 0 ? C.txT : C.brand,
              }}>Prev</button>
              <button onClick={(e) => { e.stopPropagation(); stopSpeaking(); onTourNext(); }} style={{
                flex: 1, padding: "4px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                background: `${C.brand}18`, border: `1px solid ${C.brand}`, color: C.brand, fontWeight: 600,
              }}>{tourStep < 18 ? "Next" : "Finish"}</button>
              <button onClick={(e) => { e.stopPropagation(); stopSpeaking(); narratedTab.current = ""; setTourStarted(false); onTourRestart(); }} title="Restart tour from beginning" style={{
                padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                background: "transparent", border: `1px solid ${C.cyan}44`, color: C.cyan,
              }}>Restart</button>
              <button onClick={(e) => { e.stopPropagation(); stopSpeaking(); setTourStarted(false); onTourExit(); }} style={{
                padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                background: "transparent", border: `1px solid ${C.brd}`, color: C.txT,
              }}>Exit</button>
            </div>
          )}
        </div>
      )}

      {/* Avatar area */}
      <div style={{ padding: "8px 8px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* HeyGen video or animated shield fallback */}
        <div style={{
          width: "100%", aspectRatio: "4/3", borderRadius: 12, overflow: "hidden", position: "relative",
          background: `radial-gradient(circle at 35% 35%, ${C.brand}44, ${C.cyan}22, ${C.bg})`,
          border: `2px solid ${heygenConnected ? C.green : speaking ? C.brand : C.brd}`,
          boxShadow: heygenConnected
            ? `0 0 16px ${C.green}44`
            : speaking ? `0 0 20px ${C.brand}44, 0 0 40px ${C.brand}22` : `0 0 8px ${C.brd}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: speaking && !heygenConnected ? "pulseGlow 2s ease-in-out infinite" : "none",
          marginBottom: 8,
        }}>
          {/* HeyGen video stream */}
          <video ref={videoRef} autoPlay playsInline muted={false} style={{
            width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 15%",
            display: heygenConnected ? "block" : "none",
          }} />
          {/* Fallback icon when not connected */}
          {!heygenConnected && <span style={{ fontSize: 56 }}>{"\u{1F6E1}"}</span>}
        </div>

        {/* Connect / disconnect button */}
        {!heygenConnected ? (
          <button onClick={(e) => { e.stopPropagation(); connectHeygen(); }} disabled={heygenLoading} style={{
            padding: "4px 12px", fontSize: 10, borderRadius: 4, marginBottom: 6, cursor: heygenLoading ? "wait" : "pointer",
            background: `${C.green}18`, border: `1px solid ${C.green}44`, color: C.green, fontWeight: 600, fontFamily: F.mono,
          }}>{heygenLoading ? "Connecting..." : "Connect Avatar"}</button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); disconnectHeygen(); }} style={{
            padding: "4px 12px", fontSize: 10, borderRadius: 4, marginBottom: 6, cursor: "pointer",
            background: `${C.danger}18`, border: `1px solid ${C.danger}44`, color: C.danger, fontWeight: 600, fontFamily: F.mono,
          }}>Disconnect</button>
        )}
        {heygenError && <span style={{ fontSize: 9, color: C.danger, marginBottom: 4 }}>{heygenError}</span>}

        {/* Subtitle */}
        {subtitle && (
          <div style={{
            fontSize: 11, color: C.txS, textAlign: "center", lineHeight: 1.4,
            padding: "4px 8px", background: `${C.bg}cc`, borderRadius: 6, maxWidth: "100%",
            marginBottom: 8,
          }}>{subtitle}</div>
        )}

        {/* Speaking controls */}
        {speaking && (
          <button onClick={(e) => { e.stopPropagation(); stopSpeaking(); }} style={{
            padding: "3px 10px", fontSize: 10, borderRadius: 4,
            background: `${C.danger}18`, border: `1px solid ${C.danger}44`, color: C.danger,
            cursor: "pointer", marginBottom: 8,
          }}>Stop</button>
        )}
      </div>

      {/* Input area */}
      <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{
        padding: "8px 12px", borderTop: `1px solid ${C.brd}`, display: "flex", gap: 6, alignItems: "center",
      }}>
        <button onClick={toggleListening} title="Voice input" style={{
          width: 28, height: 28, borderRadius: "50%", fontSize: 13, cursor: "pointer",
          background: listening ? `${C.danger}22` : "transparent",
          border: `1px solid ${listening ? C.danger : C.brd}`,
          color: listening ? C.danger : C.txT,
          animation: listening ? "pulse 1.5s infinite" : "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{"\uD83C\uDFA4"}</button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") askQuestion(); }}
          placeholder={thinking ? "Thinking..." : "Ask about this panel..."}
          disabled={thinking}
          style={{
            flex: 1, padding: "4px 8px", fontSize: 11, fontFamily: F.mono,
            background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 4,
            color: C.tx, outline: "none",
          }}
        />
        <button onClick={() => askQuestion()} disabled={thinking || !input.trim()} style={{
          padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: thinking ? "wait" : "pointer",
          background: `${C.brand}18`, border: `1px solid ${C.brand}44`, color: C.brand, fontWeight: 600,
        }}>{thinking ? "..." : "Ask"}</button>
      </div>
    </div>
  );
}
