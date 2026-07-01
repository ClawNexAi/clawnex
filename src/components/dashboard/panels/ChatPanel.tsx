"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, F, G } from "../constants";
import { Dot } from "../shared";
import { BrandWordmark } from "../BrandWordmark";
import type { TabId } from "../types";

// ---------------------------------------------------------------------------
// Chat model fallback list
// ---------------------------------------------------------------------------

const CHAT_MODELS_FALLBACK = [
  { id: "openclaw", label: "OpenClaw (auto)", provider: "gateway" },
  { id: "qwen/qwen3-coder-next", label: "Qwen3 Coder (Fleet)", provider: "lmstudio-fleet" },
  { id: "qwen/qwen3.5-9b", label: "Qwen3.5 9B (Fleet)", provider: "lmstudio-fleet" },
  { id: "qwen/qwen3.5-35b-a3b", label: "Qwen3.5 35B (Fleet)", provider: "lmstudio-fleet" },
  { id: "qwen/qwen3.5-9b", label: "Qwen3.5 9B (Main)", provider: "lmstudio-main" },
];

type ChatMode = "bubbles" | "bubbles+avatar" | "avatar";

// ---------------------------------------------------------------------------
// HeyGen Avatar sub-component
// ---------------------------------------------------------------------------

function HeyGenAvatar({ size = 80, sessionRef, onStop, onConnectionChange }: { size?: number; sessionRef: React.MutableRefObject<{ session: unknown } | null>; onStop?: () => void; onConnectionChange?: (connected: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async () => {
    if (sessionRef.current || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      // Get session token from backend
      const tokenRes = await fetch("/api/voice/heygen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_token" }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        setError(err.error || `HTTP ${tokenRes.status}`);
        setConnecting(false);
        return;
      }
      const { session_token } = await tokenRes.json();
      if (!session_token) { setError("No session token"); setConnecting(false); return; }

      // Import SDK dynamically (client-side only)
      const { LiveAvatarSession } = await import("@heygen/liveavatar-web-sdk");

      const session = new LiveAvatarSession(session_token);

      // Listen for stream ready — attach video AFTER tracks arrive
      (session as unknown as { on: (event: string, cb: () => void) => void }).on("session.stream_ready", () => {
        if (videoRef.current) {
          session.attach(videoRef.current);
          setConnected(true);
          setConnecting(false);
          onConnectionChange?.(true);
        }
      });

      (session as unknown as { on: (event: string, cb: () => void) => void }).on("session.disconnected", () => {
        setConnected(false);
        sessionRef.current = null;
        onConnectionChange?.(false);
      });

      // Start the session — stream_ready fires after WebRTC tracks arrive
      await session.start();
      sessionRef.current = { session };
    } catch (err) {
      console.error("[HeyGen] Session start error:", err);
      setError(err instanceof Error ? err.message : "Connection failed");
      setConnecting(false);
    }
  }, [connecting, sessionRef]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        try {
          const s = sessionRef.current.session as { stop: () => Promise<void> };
          s.stop().catch(() => {});
        } catch {}
        sessionRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (sessionRef.current) {
      try {
        const s = sessionRef.current.session as { stop: () => Promise<void> };
        await s.stop();
      } catch {}
      sessionRef.current = null;
      setConnected(false);
      onConnectionChange?.(false);
    }
    if (onStop) onStop();
  }, [sessionRef, onStop, onConnectionChange]);

  // Inactivity auto-disconnect — if avatar hasn't spoken for 60s, disconnect to save credits
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!connected) return;
    lastActivityRef.current = Date.now(); // Reset on connect
    const check = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 60000) {
        handleDisconnect();
      }
    }, 5000);
    return () => clearInterval(check);
  }, [connected, handleDisconnect]);
  // Expose activity reset so speak() calls can keep the session alive
  useEffect(() => {
    if (!connected || !sessionRef.current) return;
    const origRepeat = (sessionRef.current.session as { repeat: (t: string) => void }).repeat;
    if (origRepeat && !(origRepeat as unknown as { _wrapped?: boolean })._wrapped) {
      const wrapped = function(this: unknown, text: string) { lastActivityRef.current = Date.now(); return origRepeat.call(this, text); };
      (wrapped as unknown as { _wrapped: boolean })._wrapped = true;
      (sessionRef.current.session as { repeat: (t: string) => void }).repeat = wrapped;
    }
  }, [connected, sessionRef]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}>
      <div style={{
        width: size, height: size, borderRadius: 16, overflow: "hidden", position: "relative",
        border: `2px solid ${connected ? C.brand : connecting ? C.warn : error ? C.danger : C.brd}`,
        boxShadow: connected ? `0 0 20px ${C.brand}44` : `0 0 8px ${C.brd}44`,
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: connected ? "block" : "none" }}
        />
        {!connected && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: `radial-gradient(circle at 35% 35%, ${C.brand}44, ${C.cyan}22, ${C.bg})`,
            cursor: !connecting ? "pointer" : "default",
          }} onClick={!connecting ? startSession : undefined}>
            <img src="/clawnex-icon.png" alt="ClawNex" width={size * 0.4} height={size * 0.4} style={{ objectFit: "contain", opacity: 0.7 }} />
          </div>
        )}
        {connected && (
          <div onClick={handleDisconnect} style={{
            position: "absolute", bottom: 4, right: 4, width: 24, height: 24, borderRadius: 6,
            background: C.danger, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "#fff", cursor: "pointer", border: `3px solid ${C.bg}`,
            boxShadow: `0 0 8px ${C.danger}66`,
          }}>{"\u25A0"}</div>
        )}
      </div>
      {!connected && !connecting && (
        <button onClick={startSession} style={{
          marginTop: 6, padding: "4px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: F.mono, cursor: "pointer", letterSpacing: "0.05em",
          background: `${C.brand}22`, border: `1px solid ${C.brand}`, color: C.brand,
        }}>Connect Avatar</button>
      )}
      {connected && (
        <button onClick={handleDisconnect} style={{
          marginTop: 6, padding: "4px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: F.mono, cursor: "pointer", letterSpacing: "0.05em",
          background: `${C.danger}22`, border: `1px solid ${C.danger}`, color: C.danger,
        }}>End Session</button>
      )}
      <span style={{ fontSize: 9, color: connected ? C.green : connecting ? C.warn : error ? C.danger : C.txT, fontFamily: F.mono, marginTop: 3, letterSpacing: "0.05em" }}>
        {connected ? "LIVE" : connecting ? "CONNECTING..." : error || ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// D-ID Avatar sub-component
// ---------------------------------------------------------------------------

function DIDAvatar({ size = 80, onStop, onSpeak }: { size?: number; onStop?: () => void; onSpeak?: (speakFn: (text: string) => void) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const startSession = useCallback(async () => {
    if (connecting || connected) return;
    setConnecting(true);
    setError(null);
    try {
      // Create stream
      const streamRes = await fetch("/api/voice/did", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_stream" }),
      });
      if (!streamRes.ok) {
        const err = await streamRes.json().catch(() => ({}));
        setError(err.error || `HTTP ${streamRes.status}`);
        setConnecting(false);
        return;
      }
      const { stream_id, offer, ice_servers } = await streamRes.json();
      if (!stream_id || !offer) { setError("No stream"); setConnecting(false); return; }
      streamIdRef.current = stream_id;

      // Create WebRTC peer connection
      const pc = new RTCPeerConnection({ iceServers: ice_servers || [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setConnected(true);
          setConnecting(false);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setConnected(false);
        }
      };

      // Set remote offer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await fetch("/api/voice/did", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sdp_answer", stream_id, answer }),
      });

      // Register speak function
      if (onSpeak) {
        onSpeak((text: string) => {
          if (streamIdRef.current) {
            fetch("/api/voice/did", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "speak", stream_id: streamIdRef.current, text }),
            }).catch(() => {});
          }
        });
      }
    } catch (err) {
      console.error("[D-ID] Session error:", err);
      setError(err instanceof Error ? err.message : "Connection failed");
      setConnecting(false);
    }
  }, [connecting, connected, onSpeak]);

  useEffect(() => {
    return () => {
      if (streamIdRef.current) {
        fetch("/api/voice/did", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", stream_id: streamIdRef.current }),
        }).catch(() => {});
      }
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (streamIdRef.current) {
      await fetch("/api/voice/did", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", stream_id: streamIdRef.current }),
      }).catch(() => {});
      streamIdRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    setConnected(false);
    if (onStop) onStop();
  }, [onStop]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}>
      <div style={{
        width: size, height: size, borderRadius: 16, overflow: "hidden", position: "relative",
        border: `2px solid ${connected ? C.brand : connecting ? C.warn : error ? C.danger : C.brd}`,
        boxShadow: connected ? `0 0 20px ${C.brand}44` : `0 0 8px ${C.brd}44`,
      }}>
        <video ref={videoRef} autoPlay playsInline muted={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: connected ? "block" : "none" }} />
        {!connected && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: `radial-gradient(circle at 35% 35%, ${C.brand}44, ${C.cyan}22, ${C.bg})`,
            cursor: !connecting ? "pointer" : "default",
          }} onClick={!connecting ? startSession : undefined}>
            <img src="/clawnex-icon.png" alt="ClawNex" width={size * 0.4} height={size * 0.4} style={{ objectFit: "contain", opacity: 0.7 }} />
          </div>
        )}
        {connected && (
          <div onClick={handleDisconnect} style={{
            position: "absolute", bottom: 4, right: 4, width: 24, height: 24, borderRadius: 6,
            background: C.danger, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "#fff", cursor: "pointer", border: `3px solid ${C.bg}`,
            boxShadow: `0 0 8px ${C.danger}66`,
          }}>{"\u25A0"}</div>
        )}
      </div>
      {!connected && !connecting && (
        <button onClick={startSession} style={{
          marginTop: 6, padding: "4px 14px", borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: F.mono, cursor: "pointer", letterSpacing: "0.05em",
          background: `${C.brand}22`, border: `1px solid ${C.brand}`, color: C.brand,
        }}>Connect Avatar</button>
      )}
      <span style={{ fontSize: 9, color: connected ? C.brand : connecting ? C.warn : error ? C.danger : C.txT, fontFamily: F.mono, marginTop: 3, letterSpacing: "0.05em" }}>
        {connected ? "D-ID LIVE" : connecting ? "CONNECTING..." : error || ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speaking Avatar (fallback shield icon)
// ---------------------------------------------------------------------------

function SpeakingAvatar({ speaking, size = 80, onStop }: { speaking: boolean; size?: number; onStop?: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0" }}>
      <div style={{
        width: size, height: size, borderRadius: "50%", position: "relative",
        background: `radial-gradient(circle at 35% 35%, ${C.brand}44, ${C.cyan}22, ${C.bg})`,
        border: `2px solid ${speaking ? C.brand : C.brd}`,
        boxShadow: speaking
          ? `0 0 20px ${C.brand}44, 0 0 40px ${C.brand}22, inset 0 0 20px ${C.brand}11`
          : `0 0 8px ${C.brd}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "box-shadow 0.3s ease, border-color 0.3s ease",
        animation: speaking ? "pulseGlow 2s ease-in-out infinite" : "none",
        cursor: speaking ? "pointer" : "default",
      }} onClick={speaking ? onStop : undefined} title={speaking ? "Click to stop" : ""}>
        <img src="/clawnex-icon.png" alt="ClawNex" width={size * 0.45} height={size * 0.45} style={{ objectFit: "contain", opacity: 0.9 }} />
        {speaking && (
          <div style={{
            position: "absolute", bottom: 4, right: 4, width: 24, height: 24, borderRadius: 6,
            background: C.danger, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "#fff", fontWeight: 700, border: `3px solid ${C.bg}`,
            boxShadow: `0 0 8px ${C.danger}66`,
          }}>{"\u25A0"}</div>
        )}
      </div>
      <span style={{ fontSize: 10, color: speaking ? C.brand : C.txT, fontFamily: F.mono, marginTop: 6, letterSpacing: "0.05em" }}>
        {speaking ? "SPEAKING — click to stop" : "READY"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel (main export)
// ---------------------------------------------------------------------------

export function ChatPanel({ onNavigate, sharedSessionRef, sharedConnected, onSharedConnect }: { onNavigate: (tab: TabId) => void; sharedSessionRef: React.MutableRefObject<{ session: unknown } | null>; sharedConnected: boolean; onSharedConnect: (connected: boolean) => void }) {
  const [messages, setMessages] = useState<Array<{ role: string; content: string; source?: string; model?: string }>>([
    { role: "system", content: "ClawNex is online. One nexus. Total control.\nPrompt Shield active with 163 built-in detections (plus any custom policy rules you've added).\nWhat would you like to investigate?" },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatModels, setChatModels] = useState(CHAT_MODELS_FALLBACK);
  const [selectedModel, setSelectedModel] = useState(CHAT_MODELS_FALLBACK[0]);
  const [chatMode, setChatMode] = useState<ChatMode>("bubbles");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [avatarProvider, setAvatarProvider] = useState<string>("shield");
  const recognitionRef = useRef<unknown>(null);
  const heygenSessionRef = sharedSessionRef; // Use shared session from parent
  const didSpeakRef = useRef<((text: string) => void) | null>(null);

  // Fetch models from API on mount
  useEffect(() => {
    (async () => {
      try {
        const [modelsRes, defaultRes] = await Promise.allSettled([
          fetch("/api/config/models"),
          fetch("/api/config/defaults"),
        ]);
        if (modelsRes.status === "fulfilled" && modelsRes.value.ok) {
          const data = await modelsRes.value.json();
          const models = (data.models || []).map((m: { model_id: string; name: string; provider_id: string; provider_name: string; provider_type: string }) => ({
            id: m.model_id,
            label: m.name || m.model_id,
            provider: m.provider_type === "openclaw" ? "gateway" : m.provider_id,
          }));
          if (models.length > 0) {
            setChatModels(models);
            if (defaultRes.status === "fulfilled" && defaultRes.value.ok) {
              const defData = await defaultRes.value.json();
              if (defData.defaultModel) {
                const defMatch = models.find((m: { id: string; provider: string }) =>
                  m.id === defData.defaultModel.modelId &&
                  (m.provider === defData.defaultModel.providerId || (defData.defaultModel.providerId === "openclaw" && m.provider === "gateway"))
                );
                if (defMatch) setSelectedModel(defMatch);
                else setSelectedModel(models[0]);
              } else { setSelectedModel(models[0]); }
            } else { setSelectedModel(models[0]); }
          }
        }
        // Load chat mode preference
        try {
          const defRes2 = await fetch("/api/config/defaults");
          if (defRes2.ok) {
            const d = await defRes2.json();
            if (d.settings?.chat_mode && ["bubbles", "bubbles+avatar", "avatar"].includes(d.settings.chat_mode)) {
              setChatMode(d.settings.chat_mode as ChatMode);
            }
          }
        } catch {}
      } catch { /* use fallback */ }
    })();
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, thinking, scrollToBottom]);

  const [voiceProvider, setVoiceProvider] = useState<string>("elevenlabs");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load voice provider preference — poll every 10s to pick up config changes
  useEffect(() => {
    const loadVoice = () => {
      fetch("/api/config/voice").then(r => r.ok ? r.json() : null).then(d => {
        if (d?.settings?.voice_provider) setVoiceProvider(d.settings.voice_provider);
        if (d?.settings?.avatar_provider) setAvatarProvider(d.settings.avatar_provider);
      }).catch(() => {});
    };
    loadVoice();
    const iv = setInterval(loadVoice, 60000);
    return () => clearInterval(iv);
  }, []);

  // Text-to-speech — HeyGen avatar > ElevenLabs > browser TTS
  const speak = useCallback(async (text: string) => {
    if (typeof window === "undefined") return;
    // Skip voice when chatMode is "bubbles" UNLESS a live avatar session is connected
    const hasLiveAvatar = sharedConnected && avatarProvider === "heygen";
    if (chatMode === "bubbles" && !hasLiveAvatar) return;

    // Try D-ID streaming avatar
    if (avatarProvider === "did" && didSpeakRef.current) {
      try {
        setSpeaking(true);
        didSpeakRef.current(text);
        const words = text.split(/\s+/).length;
        setTimeout(() => setSpeaking(false), Math.max(3000, words * 300));
        return;
      } catch { setSpeaking(false); }
    }

    // Try HeyGen streaming avatar — only when actually connected (not stale ref)
    if (sharedConnected && heygenSessionRef.current) {
      try {
        setSpeaking(true);
        const session = heygenSessionRef.current.session as { repeat: (text: string) => string; interrupt: () => void };
        const clean = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]/g, "$1").replace(/[#*_`]/g, "").replace(/\n{2,}/g, ". ").replace(/\n/g, " ").trim();
        if (clean) {
          session.repeat(clean.slice(0, 3000));
        }
        const words = clean.split(/\s+/).length;
        const estimatedMs = Math.max(3000, words * 300);
        setTimeout(() => setSpeaking(false), estimatedMs);
        return; // Don't fall through to ElevenLabs — HeyGen handles voice
      } catch (err) {
        console.error("[HeyGen] Speak error:", err);
        setSpeaking(false);
        // Fall through to ElevenLabs as backup
      }
    }

    // Try ElevenLabs — with retry on 502 (dev server compilation race)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setSpeaking(true);
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok && res.headers.get("content-type")?.includes("audio")) {
          const arrayBuffer = await res.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          await audio.play();
          return;
        }
        if (res.status === 502 && attempt === 0) {
          await new Promise(r => setTimeout(r, 2000)); // Wait for route to compile
          continue;
        }
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
    const clean = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]/g, "$1").replace(/[#*_`]/g, "");
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.0;
    utterance.pitch = 0.9;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [chatMode, voiceProvider, avatarProvider, sharedConnected]);

  // Voice input (Speech Recognition)
  const toggleListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      (recognitionRef.current as { stop: () => void })?.stop();
      setListening(false);
      return;
    }

    const recognition = new (SpeechRecognition as new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      onresult: (e: { results: { [key: number]: { [key: number]: { transcript: string } } }; resultIndex: number }) => void;
      onerror: () => void; onend: () => void; start: () => void; stop: () => void;
    })();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = e.results[e.resultIndex][0].transcript;
      setInput(prev => prev + (prev ? " " : "") + transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  const handleSend = useCallback(async (msg?: string) => {
    const text = msg || input.trim();
    if (!text || thinking) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setThinking(true);
    try {
      const history = messages.filter(m => m.role !== "system").slice(-20);
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history, model: selectedModel.id, provider: selectedModel.provider }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.content, source: data.source, model: data.model }]);
      speak(data.content);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Retrying...", source: "error" }]);
    } finally { setThinking(false); }
  }, [input, thinking, messages, selectedModel, speak]);

  const handleModeChange = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    if (mode === "bubbles") { window.speechSynthesis?.cancel(); setSpeaking(false); }
    fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "chat_mode", value: mode }) }).catch(() => {});
  }, []);

  const suggestions = ["What is the highest priority?", "Show token costs", "Show shield status", "Is OpenClaw routed through ClawNex?", "Is pentest-agent compromised?", "Show fleet status"];

  // Markdown renderer
  const renderMarkdown = useCallback((text: string) => {
    const TAB_MAP: Record<string, TabId> = {
      "alerts": "alertsIncidents", "alert": "alertsIncidents", "incidents": "alertsIncidents",
      "prompt shield": "shield", "shield": "shield",
      "infrastructure": "infrastructure", "infra": "infrastructure",
      "correlations": "correlations", "agents": "agents", "fleet": "fleet", "models": "modelsCost",
      "token intel": "tokenCost", "token": "tokenCost",
      "audit": "auditEvidence", "audit trail": "auditEvidence",
      "workspace": "workspace", "security posture": "securityPosture",
      "policies": "configuration", "compliance": "executiveReports",
    };
    return text.split("\n").map((line, li) => {
      // Detect list-prefix shape FIRST and strip it from the body so the
      // tokenizer doesn't keep "1. " or "- " in the rendered text. Without
      // this strip, numbered list lines produced "1." (the marker) followed
      // by "1. Fleet ..." (the body still containing the leading number) —
      // dogfood QA caught the duplicate numbering on /Show fleet status/.
      const numberedMatch = line.match(/^\s*(\d+)\.\s+/);
      const bulletMatch = !numberedMatch ? line.match(/^\s*[-\u2022]\s+/) : null;
      const body = numberedMatch
        ? line.slice(numberedMatch[0].length)
        : bulletMatch
          ? line.slice(bulletMatch[0].length)
          : line;
      const parts: React.ReactNode[] = [];
      let remaining = body;
      let ki = 0;
      while (remaining.length > 0) {
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const linkMatch = remaining.match(/\[([^\]]+)\]/);
        const boldIdx = boldMatch?.index ?? Infinity;
        const linkIdx = linkMatch?.index ?? Infinity;
        if (boldIdx === Infinity && linkIdx === Infinity) { parts.push(<span key={ki++}>{remaining}</span>); break; }
        if (boldIdx <= linkIdx && boldMatch) {
          if (boldIdx > 0) parts.push(<span key={ki++}>{remaining.slice(0, boldIdx)}</span>);
          parts.push(<strong key={ki++} style={{ color: C.tx, fontWeight: 700 }}>{boldMatch[1]}</strong>);
          remaining = remaining.slice(boldIdx + boldMatch[0].length);
        } else if (linkMatch) {
          if (linkIdx! > 0) parts.push(<span key={ki++}>{remaining.slice(0, linkIdx)}</span>);
          const label = linkMatch[1];
          const tabId = TAB_MAP[label.toLowerCase()];
          parts.push(tabId
            ? <span key={ki++} onClick={() => onNavigate(tabId)} style={{ color: C.info, cursor: "pointer", textDecoration: "underline", textDecorationColor: `${C.info}44`, textUnderlineOffset: 2, fontWeight: 600 }}>{label}</span>
            : <span key={ki++} style={{ color: C.info, fontWeight: 600 }}>{label}</span>
          );
          remaining = remaining.slice(linkIdx! + linkMatch[0].length);
        }
      }
      if (bulletMatch) return <div key={li} style={{ paddingLeft: 12, marginBottom: 2, display: "flex", gap: 6 }}><span style={{ color: C.brand }}>{"\u2022"}</span><span>{parts}</span></div>;
      if (numberedMatch) return <div key={li} style={{ paddingLeft: 12, marginBottom: 2, display: "flex", gap: 6 }}><span style={{ color: C.brand, fontWeight: 700, fontFamily: F.mono, minWidth: 16 }}>{numberedMatch[1]}.</span><span>{parts}</span></div>;
      if (line.trim() === "") return <div key={li} style={{ height: 6 }} />;
      return <div key={li}>{parts}</div>;
    });
  }, [onNavigate]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    // Send interrupt to HeyGen if active
    if (heygenSessionRef.current) {
      try {
        const session = heygenSessionRef.current.session as { interrupt: () => void };
        session.interrupt();
      } catch {}
    }
    setSpeaking(false);
  }, []);

  const showAvatar = chatMode === "bubbles+avatar" || chatMode === "avatar";
  const showBubbles = chatMode === "bubbles" || chatMode === "bubbles+avatar";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.brd}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Dot color={C.green} glow size={6} />
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: F.disp, color: C.tx, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <BrandWordmark size={13} />
            {" AI"}
          </span>
          <div style={{ flex: 1 }} />
          {/* Mode selector */}
          <div style={{ display: "flex", gap: 2 }}>
            {([["bubbles", "\uD83D\uDCAC"], ["bubbles+avatar", "\uD83D\uDCAC\uD83D\uDE00"], ["avatar", "\uD83D\uDE00"]] as [ChatMode, string][]).map(([mode, icon]) => (
              <button key={mode} onClick={() => handleModeChange(mode)} title={mode} style={{
                padding: "2px 6px", borderRadius: 3, fontSize: 11, cursor: "pointer",
                background: chatMode === mode ? `${C.brand}22` : "transparent",
                border: `1px solid ${chatMode === mode ? C.brand : C.brd}`,
                color: chatMode === mode ? C.brand : C.txT,
              }}>{icon}</button>
            ))}
            <div style={{ width: 1, height: 16, background: C.brd, margin: "0 2px" }} />
            <button onClick={() => {
              const next = voiceProvider === "elevenlabs" ? "browser" : "elevenlabs";
              setVoiceProvider(next);
              fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "voice_provider", value: next }) }).catch(() => {});
            }} title={`Voice: ${voiceProvider === "elevenlabs" ? "ElevenLabs" : "Browser"}`} style={{
              padding: "2px 6px", borderRadius: 3, fontSize: 9, cursor: "pointer", fontFamily: F.mono, fontWeight: 600,
              background: voiceProvider === "elevenlabs" ? `${C.cyan}22` : "transparent",
              border: `1px solid ${voiceProvider === "elevenlabs" ? C.cyan : C.brd}`,
              color: voiceProvider === "elevenlabs" ? C.cyan : C.txT,
            }}>{voiceProvider === "elevenlabs" ? "\uD83C\uDFA4 EL" : "\uD83D\uDD0A"}</button>
          </div>
        </div>
        <select value={`${selectedModel.id}::${selectedModel.provider}`} onChange={e => {
          const [id, provider] = e.target.value.split("::");
          const m = chatModels.find(cm => cm.id === id && cm.provider === provider);
          if (m) setSelectedModel(m);
        }} style={{
          width: "100%", padding: "4px 8px", ...G.stat, borderRadius: 4,
          color: C.brand, fontFamily: F.mono, fontSize: 11, outline: "none", cursor: "pointer",
        }}>
          {chatModels.map(m => (
            <option key={`${m.id}::${m.provider}`} value={`${m.id}::${m.provider}`}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Avatar */}
      {showAvatar && avatarProvider === "heygen" && (
        <HeyGenAvatar size={chatMode === "avatar" ? 180 : 120} sessionRef={heygenSessionRef} onStop={stopSpeaking} onConnectionChange={onSharedConnect} />
      )}
      {showAvatar && avatarProvider === "did" && (
        <DIDAvatar size={chatMode === "avatar" ? 100 : 64} onStop={stopSpeaking} onSpeak={(fn) => { didSpeakRef.current = fn; }} />
      )}
      {showAvatar && avatarProvider !== "heygen" && avatarProvider !== "did" && (
        <SpeakingAvatar speaking={speaking || thinking} size={chatMode === "avatar" ? 100 : 64} onStop={stopSpeaking} />
      )}

      {/* Messages */}
      {showBubbles && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div key={i} style={{
                display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}>
                <div style={{
                  maxWidth: "85%", padding: "8px 12px", fontSize: 12, lineHeight: 1.6, fontFamily: F.sans,
                  borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                  ...G.stat,
                  background: isUser ? `${C.brand}14` : `${C.srf}cc`,
                  border: `1px solid ${isUser ? `${C.brand}28` : `${C.brd}44`}`,
                  color: C.tx,
                }}>
                  {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
                  {m.role === "assistant" && (m.source || m.model) && (
                    <div style={{ fontSize: 10, color: C.txT, marginTop: 4, fontFamily: F.mono, borderTop: `1px solid ${C.brd}33`, paddingTop: 3 }}>
                      {m.model && m.model !== "keyword-matcher" ? m.model + " " : ""}via {m.source}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {thinking && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
              <div style={{
                padding: "8px 14px", borderRadius: "12px 12px 12px 2px", ...G.stat,
                fontSize: 12, color: C.txT, fontStyle: "italic",
              }}>
                <span style={{ animation: "pulse 1.5s ease-in-out infinite" }}>thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Avatar-only: show last response as text below avatar */}
      {chatMode === "avatar" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {messages.length > 1 && (
            <div style={{ textAlign: "center", fontSize: 12, color: C.txS, fontFamily: F.sans, lineHeight: 1.6, maxWidth: "90%", ...G.stat, padding: "12px 16px", borderRadius: 10 }}>
              {renderMarkdown(messages[messages.length - 1].content)}
            </div>
          )}
        </div>
      )}

      {/* Suggestions + Input */}
      <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.brd}` }}>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6 }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => handleSend(s)} disabled={thinking} style={{
              padding: "2px 7px", background: "transparent", border: `1px solid ${C.brd}`, borderRadius: 10,
              color: C.txT, fontSize: 10, cursor: thinking ? "not-allowed" : "pointer", fontFamily: F.sans,
            }}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Ask ClawNex..." disabled={thinking}
            style={{
              flex: 1, padding: "6px 10px", ...G.stat, borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none",
            }}
          />
          {/* Mic button */}
          <button onClick={toggleListening} title={listening ? "Stop listening" : "Voice input"} style={{
            width: 30, height: 30, borderRadius: 6, border: "none",
            background: listening ? `${C.danger}33` : "transparent",
            color: listening ? C.danger : C.txT, fontSize: 14,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            animation: listening ? "pulse 1s ease-in-out infinite" : "none",
            borderWidth: 1, borderStyle: "solid", borderColor: listening ? C.danger : C.brd,
          }}>{"\uD83C\uDF99"}</button>
          {/* Stop speaking button */}
          {speaking && (
            <button onClick={stopSpeaking} title="Stop speaking" style={{
              width: 30, height: 30, borderRadius: 6,
              background: C.danger, color: "#fff", fontSize: 12,
              border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              animation: "pulse 2s ease-in-out infinite",
              boxShadow: `0 0 8px ${C.danger}66`,
            }}>{"\u25A0"}</button>
          )}
          {/* Send button */}
          <button onClick={() => handleSend()} disabled={thinking || !input.trim()} style={{
            width: 30, height: 30, background: thinking || !input.trim() ? C.brd : C.brand, color: C.bg,
            border: "none", borderRadius: 6, fontWeight: 700, cursor: thinking || !input.trim() ? "not-allowed" : "pointer", fontSize: 13,
          }}>{"\u2191"}</button>
        </div>
      </div>
    </div>
  );
}
