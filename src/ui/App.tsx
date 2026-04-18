/**
 * Deep Research UI — three panes:
 *   1. Chat         — talk to the ResearchAgent
 *   2. File tree    — live list of files the agent is writing
 *   3. File viewer  — inline markdown preview + download
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import ReactMarkdown from "react-markdown";

// ─────────────────────────────────────────────────────────────────────────────
// Session handling — one DO per browser, stable across reloads
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "deep-research:session";

function getSessionId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = `s-${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

type FileEntry = { path: string; size: number };

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const [sessionId, setSessionId] = useState(() => getSessionId());
  const agent = useAgent({ agent: "ResearchAgent", name: sessionId });
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });

  const [input, setInput] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Poll workspace files — 2s during streaming, 10s otherwise
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/agent/${sessionId}/files`);
        if (!res.ok) return;
        const data = (await res.json()) as { files: FileEntry[] };
        if (!cancelled) setFiles(data.files);
      } catch {
        /* ignore */
      }
    };
    tick();
    const interval = status === "streaming" ? 2000 : 10_000;
    const t = setInterval(tick, interval);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sessionId, status]);

  // When a file is selected, load its content
  useEffect(() => {
    if (!activeFile) {
      setFileContent("");
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    fetch(`/api/agent/${sessionId}/files${activeFile}`)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setFileContent(text);
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, sessionId, files.length]);

  // When report.md appears and nothing is selected, auto-open it
  useEffect(() => {
    if (!activeFile) {
      const report = files.find((f) => f.path === "/report.md");
      if (report) setActiveFile(report.path);
    }
  }, [files, activeFile]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const newSession = () => {
    const id = `s-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(STORAGE_KEY, id);
    setSessionId(id);
    setFiles([]);
    setActiveFile(null);
    setFileContent("");
    clearHistory();
  };

  const sortedFiles = useMemo(() => {
    const rank = (p: string) =>
      p === "/report.md" ? 0
      : p === "/plan.md"   ? 1
      : p === "/notes.md"  ? 2
      : p.startsWith("/sources/") ? 3
      : 4;
    return [...files].sort(
      (a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path),
    );
  }, [files]);

  return (
    <div className="h-screen flex flex-col">
      <Header
        sessionId={sessionId}
        status={status}
        onNewSession={newSession}
      />

      <div className="flex-1 grid grid-cols-[minmax(340px,1fr)_280px_minmax(400px,1.5fr)] min-h-0">
        <ChatPane
          messages={messages}
          scrollRef={chatScrollRef}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
          status={status}
        />

        <FilesPane
          files={sortedFiles}
          activeFile={activeFile}
          sessionId={sessionId}
          onSelect={setActiveFile}
        />

        <ViewerPane
          activeFile={activeFile}
          content={fileContent}
          loading={loadingFile}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

function Header({
  sessionId,
  status,
  onNewSession,
}: {
  sessionId: string;
  status: string;
  onNewSession: () => void;
}) {
  return (
    <header className="border-b border-neutral-800 px-6 py-3 flex items-center gap-4 bg-neutral-950">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-500" />
        <h1 className="text-lg font-semibold">Deep Research</h1>
      </div>
      <span className="text-xs text-neutral-500 font-mono">
        session:&nbsp;{sessionId}
      </span>
      <span className="ml-auto flex items-center gap-3">
        <StatusPill status={status} />
        <button
          onClick={onNewSession}
          className="text-xs px-3 py-1.5 border border-neutral-700 rounded hover:bg-neutral-800 transition"
        >
          New session
        </button>
      </span>
    </header>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    streaming: "bg-amber-600/20 text-amber-400 border-amber-700",
    submitted: "bg-amber-600/20 text-amber-400 border-amber-700",
    ready: "bg-neutral-800 text-neutral-400 border-neutral-700",
    error: "bg-red-900/30 text-red-400 border-red-800",
  };
  const cls = colors[status] ?? colors.ready;
  return (
    <span
      className={`text-xs px-2 py-1 border rounded font-mono ${cls}`}
    >
      {status === "streaming" ? "researching…" : status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat pane
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

interface ChatMessage {
  id: string;
  role: string;
  parts: ChatMessagePart[];
}

function ChatPane({
  messages,
  scrollRef,
  input,
  setInput,
  onSubmit,
  status,
}: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  status: string;
}) {
  return (
    <section className="flex flex-col min-h-0 border-r border-neutral-800">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && <EmptyState />}

        {messages.map((msg) => (
          <ChatMessageView key={msg.id} msg={msg} />
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-neutral-800 p-4 flex gap-2 bg-neutral-950"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Research a topic…"
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-700 placeholder:text-neutral-600"
          disabled={status === "streaming"}
        />
        <button
          type="submit"
          disabled={status === "streaming" || !input.trim()}
          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition"
        >
          {status === "streaming" ? "…" : "Research"}
        </button>
      </form>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="text-neutral-500 text-sm space-y-3 max-w-lg">
      <p className="text-neutral-400">
        Ask a research question. The agent will plan, search, scrape, cite, and
        write a full report into{" "}
        <code className="text-amber-400">report.md</code> — plus every source it
        used into <code className="text-amber-400">sources/</code>.
      </p>
      <div className="border border-neutral-800 rounded p-3 space-y-2">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Examples
        </p>
        <ul className="space-y-1">
          <li>• Top competitors to Cursor and their current pricing</li>
          <li>• How Karpathy uses LLMs to build personal knowledge bases</li>
          <li>• Cloudflare Durable Objects pricing vs alternatives</li>
          <li>• State of AI voice agents in Q2 2026</li>
        </ul>
      </div>
    </div>
  );
}

function ChatMessageView({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`max-w-[80ch] ${isUser ? "ml-auto" : ""}`}>
      <div className="text-xs text-neutral-500 mb-1 font-mono">
        {isUser ? "you" : "agent"}
      </div>
      <div
        className={`rounded-lg px-4 py-3 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-amber-900/20 border border-amber-800/50"
            : "bg-neutral-900 border border-neutral-800"
        }`}
      >
        {msg.parts.map((part, i) => {
          if (part.type === "text") {
            return <span key={i}>{part.text}</span>;
          }
          if (part.type.startsWith("tool-")) {
            return <ToolCallView key={i} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ToolCallView({ part }: { part: ChatMessagePart }) {
  const name = part.toolName ?? part.type.replace(/^tool-/, "");
  const input = part.input as Record<string, unknown> | undefined;
  const preview =
    input?.query ?? input?.url ?? input?.path ?? "";
  return (
    <div className="my-2 text-xs font-mono bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 flex items-center gap-2">
      <span className="text-amber-400">🔧</span>
      <span className="text-neutral-300">{name}</span>
      {preview && (
        <span className="text-neutral-500 truncate">
          {String(preview).slice(0, 100)}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Files pane
// ─────────────────────────────────────────────────────────────────────────────

function FilesPane({
  files,
  activeFile,
  sessionId,
  onSelect,
}: {
  files: FileEntry[];
  activeFile: string | null;
  sessionId: string;
  onSelect: (path: string) => void;
}) {
  return (
    <aside className="flex flex-col min-h-0 bg-neutral-950 border-r border-neutral-800">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <span className="ml-2 text-xs text-neutral-500">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {files.length === 0 && (
          <p className="text-neutral-600 text-xs p-3 leading-relaxed">
            Files the agent writes (plan.md, notes.md, sources/…, report.md)
            will appear here live.
          </p>
        )}
        {files.map((f) => {
          const isActive = f.path === activeFile;
          const filename = f.path.split("/").pop() ?? f.path;
          const isReport = f.path === "/report.md";
          const isSource = f.path.startsWith("/sources/");
          return (
            <div
              key={f.path}
              className={`group flex items-center rounded text-sm font-mono mb-0.5 ${
                isActive
                  ? "bg-amber-900/30 border border-amber-800"
                  : "hover:bg-neutral-900 border border-transparent"
              }`}
            >
              <button
                onClick={() => onSelect(f.path)}
                className="flex-1 text-left px-2 py-1.5 truncate"
                title={f.path}
              >
                <span
                  className={
                    isReport
                      ? "text-amber-300 font-semibold"
                      : isSource
                        ? "text-neutral-400"
                        : "text-amber-400"
                  }
                >
                  {filename}
                </span>
                <span className="text-neutral-600 text-xs ml-2">
                  {formatSize(f.size)}
                </span>
              </button>
              <a
                href={`/api/agent/${sessionId}/files${f.path}?download=1`}
                className="opacity-0 group-hover:opacity-100 px-2 text-xs text-neutral-500 hover:text-amber-400 transition"
                title="Download"
              >
                ↓
              </a>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer pane
// ─────────────────────────────────────────────────────────────────────────────

function ViewerPane({
  activeFile,
  content,
  loading,
  sessionId,
}: {
  activeFile: string | null;
  content: string;
  loading: boolean;
  sessionId: string;
}) {
  if (!activeFile) {
    return (
      <section className="flex items-center justify-center bg-neutral-950 p-8">
        <p className="text-neutral-600 text-sm">
          Select a file to view it here
        </p>
      </section>
    );
  }

  const filename = activeFile.split("/").pop() ?? activeFile;
  const isMarkdown = filename.endsWith(".md");

  return (
    <section className="flex flex-col min-h-0 bg-neutral-950">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center">
        <h2 className="text-sm font-mono text-amber-400 truncate">
          {activeFile}
        </h2>
        <a
          href={`/api/agent/${sessionId}/files${activeFile}?download=1`}
          className="ml-auto text-xs px-3 py-1 border border-neutral-700 rounded hover:bg-neutral-800 transition"
        >
          Download
        </a>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <p className="text-neutral-600 text-sm">Loading…</p>
        )}
        {!loading && isMarkdown && (
          <article className="prose-research max-w-3xl">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        )}
        {!loading && !isMarkdown && (
          <pre className="text-xs font-mono text-neutral-300 whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </div>
    </section>
  );
}
