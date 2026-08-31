"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  suggestions?: string[];
}

export interface ComposerPrompt {
  id: string;
  text: string;
}

export function ChatPanel({
  messages,
  onSend,
  isThinking,
  composerPrompt,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  isThinking: boolean;
  composerPrompt?: ComposerPrompt;
}) {
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    if (!composerPrompt) return;
    setValue(composerPrompt.text);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = composerPrompt.text.length;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }, [composerPrompt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    sendCurrentValue();
  }

  function sendCurrentValue() {
    const text = value.trim();
    if (!text || isThinking) return;
    setValue("");
    onSend(text);
  }

  return (
    <aside className="chatPanel" aria-label="Calendar chat">
      <div className="panelHeading">
        <div>
          <h1>Chat</h1>
          <span className="smallMeta">Schedule events, search slots, or update your calendar.</span>
        </div>
      </div>

      <div className="messageList">
        {messages.map((message) => (
          <div key={message.id} className={`messageGroup ${message.role}`}>
            <div className="messageMeta">
              <span className="messageRole">{message.role === "assistant" ? "System" : "You"}</span>
            </div>
            <p className="messageText">{message.text}</p>
            {message.suggestions?.length ? (
              <div className="suggestionRow">
                {message.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestionChip"
                    disabled={isThinking}
                    onClick={() => onSend(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {isThinking ? (
          <div className="statusLine" role="status">
            <span className="statusDot" /> Processing request…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composerBox">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendCurrentValue();
              }
            }}
            placeholder="Type a message or schedule an event…"
            aria-label="Message prompt input"
          />
          <button className="primaryButton" type="submit" disabled={isThinking || !value.trim()}>Send</button>
        </div>
        <div className="composerHint">Enter sends · Shift+Enter adds a new line</div>
      </form>
    </aside>
  );
}