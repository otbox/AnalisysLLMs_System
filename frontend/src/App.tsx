"use client";
import React, { useState } from "react";
import "./App.css";
import { PROFILE_CONFIGS, type ProfileKey, type Theme } from "./types";
import { ProfilePanel }    from "./components/ProfilePanel";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { NemotronPanel }   from "./components/NemotronPanel";

const API_BASE = "http://localhost:3000";

const PROFILE_TAB_COLORS: Record<string, string> = {
  blue:   "active",
  purple: "active purple",
  green:  "active green",
  orange: "active orange",
};

export default function App() {
  const [theme, setTheme]               = useState<Theme>("dark");
  const [sessionId, setSessionId]       = useState("session-1");
  const [activeProfile, setActiveProfile] = useState<ProfileKey>("AnalisysComponentsLLM");
  const [selectedModels, setSelectedModels] = useState<string[]>(["gemini-2.5-flash"]);

  return (
    <div className={`app ${theme}`}>

      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">🤖 LLM UI Analyzer</h1>
          <div className="session-group">
            <span className="session-label">Session:</span>
            <input
              className="session-input"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>
      </header>

      {/* ── Profile tabs ── */}
      <div className="profile-tabs">
        {PROFILE_CONFIGS.map((p) => (
          <button
            key={p.key}
            className={`profile-tab ${activeProfile === p.key ? PROFILE_TAB_COLORS[p.color] : ""}`}
            onClick={() => setActiveProfile(p.key)}
          >
            {p.emoji} {p.label}
          </button>
        ))}
      </div>

      {/* ── Active panel ── */}
      {activeProfile === "annotation" ? (
        <AnnotationPanel apiBase={API_BASE} />
      ) : activeProfile === "nemotron" ? (
        <NemotronPanel apiBase={API_BASE} />
      ) : (
        PROFILE_CONFIGS.filter((p) => p.key === activeProfile).map((p) => (
          <ProfilePanel
            key={p.key}
            profile={p}
            sessionId={sessionId}
            apiBase={API_BASE}
            selectedModels={selectedModels}
            onModelsChange={setSelectedModels}
          />
        ))
      )}

    </div>
  );
}
