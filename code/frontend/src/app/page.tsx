"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const passages = [
  "slow down and find your rhythm every little word is a step forward let your thoughts flow like water through a quiet garden the world can wait for a moment while you make something beautiful one letter at a time",
  "somewhere between the morning light and the evening sky there is a little space for you to grow follow your curiosity take the scenic route and remember that small beginnings can lead to wonderful things",
  "open the window and let the fresh air in today is a good day to learn something new find joy in the simple things a warm cup of coffee a favorite song and the gentle sound of keys beneath your fingers",
];

export default function Home() {
  const [duration, setDuration] = useState(30);
  const [mode, setMode] = useState<"time" | "words">("time");
  const [round, setRound] = useState(0);
  const [value, setValue] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [focused, setFocused] = useState(false);
  const [theme, setTheme] = useState("lavender");
  const input = useRef<HTMLTextAreaElement>(null);
  const text = passages[round % passages.length];
  const finished =
    (mode === "time" && elapsed >= duration) || value.length >= text.length;
  const correct = [...value].filter(
    (char, index) => char === text[index],
  ).length;
  const accuracy = value.length
    ? Math.round((correct / value.length) * 100)
    : 100;
  const wpm = elapsed > 0 ? Math.round(correct / 5 / (elapsed / 60)) : 0;

  useEffect(() => {
    if (!started || finished) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - started) / 1000),
      100,
    );
    return () => window.clearInterval(timer);
  }, [started, finished]);

  function reset(nextMode = mode, nextDuration = duration) {
    setMode(nextMode);
    setDuration(nextDuration);
    setValue("");
    setStarted(null);
    setElapsed(0);
    setRound((current) => current + 1);
    input.current?.focus();
  }

  return (
    <div className={`typing-app theme-${theme}`}>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-icon">⌘</span>
          <span>
            i see i type<span className="brand-dot">.</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <span className="nav-active">⌨ &nbsp; practice</span>
          <Link href="/profile">↗ &nbsp; your progress</Link>
        </nav>
        <Link
          className="profile-link"
          href="/profile"
          aria-label="Your profile"
        >
          ☺
        </Link>
      </header>

      <main className="practice-main">
        <div className="eyebrow">
          <span /> A LITTLE FOCUS. A LITTLE FLOW.
        </div>
        <h1>
          Find your <span>rhythm.</span>
        </h1>
        <p className="intro">
          A quiet place for your thoughts. A little playground for your fingers.
        </p>

        <div className="test-toolbar">
          <div className="mode-switch">
            <button
              type="button"
              className={mode === "time" ? "selected" : ""}
              onClick={() => reset("time")}
            >
              ◷ &nbsp; time
            </button>
            <button
              type="button"
              className={mode === "words" ? "selected" : ""}
              onClick={() => reset("words")}
            >
              ≡ &nbsp; words
            </button>
          </div>
          <span className="toolbar-divider" />
          {mode === "time" ? (
            <div className="durations">
              {[15, 30, 60, 120].map((seconds) => (
                <button
                  type="button"
                  key={seconds}
                  aria-pressed={duration === seconds}
                  className={duration === seconds ? "selected" : ""}
                  onClick={() => reset(mode, seconds)}
                >
                  {seconds}
                </button>
              ))}
            </div>
          ) : (
            <span className="word-count">{text.split(" ").length} words</span>
          )}
          <span className="language">◎ &nbsp; english</span>
        </div>

        <section
          className={`typing-card ${focused ? "is-focused" : ""}`}
          aria-label="Typing practice"
        >
          <div className="card-top">
            <span className="session-label">
              <span />{" "}
              {finished
                ? "SESSION COMPLETE"
                : started
                  ? "IN YOUR FLOW"
                  : "LET’S GET INTO THE FLOW"}
            </span>
            <span className="timer">
              {mode === "time"
                ? Math.max(0, Math.ceil(duration - elapsed))
                : Math.floor(elapsed)}
              <small>s</small>
            </span>
          </div>
          <div className="typing-area">
            <div className="passage" aria-hidden="true">
              {text.split(" ").map((word, wordIndex, words) => {
                const offset =
                  words.slice(0, wordIndex).join(" ").length +
                  (wordIndex ? 1 : 0);
                return (
                  <span className="word" key={`${round}-${offset}`}>
                    {[
                      ...(word + (wordIndex < words.length - 1 ? " " : "")),
                    ].map((char, index) => (
                      <span
                        key={`${offset + index}`}
                        className={`${offset + index < value.length ? (value[offset + index] === char ? "correct" : "incorrect") : ""} ${offset + index === value.length && !finished ? "caret" : ""}`}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                );
              })}
            </div>
            <textarea
              ref={input}
              aria-label={`Type this passage: ${text}`}
              value={value}
              disabled={finished}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onPaste={(event) => event.preventDefault()}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => {
                if (!started) setStarted(Date.now());
                setValue(event.target.value.slice(0, text.length));
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  reset();
                }
              }}
            />
          </div>
          <div className="card-bottom">
            <span>
              {finished
                ? "Beautiful work. Ready for another round?"
                : focused
                  ? "You’ve got this. One letter at a time."
                  : "Click the words above and start typing"}
            </span>
            <button
              type="button"
              className="restart"
              onClick={() => reset()}
              aria-label="Restart test"
            >
              ↻
            </button>
          </div>
        </section>

        <div className="stats" aria-live="polite">
          <div>
            <strong>
              {wpm}
              <small>wpm</small>
            </strong>
            <span>words per minute</span>
          </div>
          <div>
            <strong>
              {accuracy}
              <small>%</small>
            </strong>
            <span>accuracy</span>
          </div>
          <div>
            <strong>
              {correct}
              <small>/{value.length}</small>
            </strong>
            <span>correct characters</span>
          </div>
        </div>
        <p className="keyboard-hint">
          <kbd>esc</kbd> restart test <span>·</span> take a breath, then take
          your time
        </p>
      </main>

      <footer className="site-footer">
        <span>Made for the love of the little clicks.</span>
        <div className="theme-picker">
          <span>make it yours</span>
          {["lavender", "sage", "peach"].map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch swatch-${color} ${theme === color ? "active" : ""}`}
              aria-label={`${color} theme`}
              aria-pressed={theme === color}
              onClick={() => setTheme(color)}
            />
          ))}
        </div>
        <span className="footer-note">
          less noise. more flow. <span>✳</span>
        </span>
      </footer>
    </div>
  );
}
