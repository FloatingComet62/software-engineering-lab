"use client";

import { useRef, useState } from "react";

const TARGET_TEXT = "The quick brown fox jumps over the lazy dog.";

export default function Home() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const focus = () => inputRef.current?.focus();

  return (
    <div
      className="flex flex-col flex-1 items-center justify-center bg-zinc-900 font-mono text-7xl text-white outline-none"
      onClick={focus}
      tabIndex={-1}
    >
      <main className="flex flex-col w-8xl text-center">
        <div className="relative flex flex-wrap break-words whitespace-pre-wrap leading-tight">
          {TARGET_TEXT.split("").map((char, i) => {
            const typedChar = input[i];
            let colorClass = "text-zinc-600/40";
            let underlineClass = "";
            if (i < input.length) {
              if (typedChar === char) {
                colorClass = "text-white";
              } else {
                colorClass = "text-red-500";
                underlineClass = "underline decoration-red-500";
              }
            }
            const isCaret = i === input.length;
            return (
              <span key={i} className="relative">
                <span className={`${colorClass} ${underlineClass}`}>
                  {char === " " ? "\u00A0" : char}
                </span>
                {isCaret && (
                  <span className="absolute top-0 left-0 h-full w-0.5 -translate-x-1/2 animate-pulse bg-zinc-300" />
                )}
              </span>
            );
          })}
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="absolute top-0 left-0 h-0 w-0 opacity-0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
      </main>
    </div>
  );
}
