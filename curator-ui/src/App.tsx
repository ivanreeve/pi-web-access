import { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Search, Clock, AlertCircle, Eye, 
  RefreshCw, Send, X, ExternalLink 
} from 'lucide-react';
import { marked } from 'marked';

// --- TYPES ---
interface ProviderStatus {
  openai: boolean;
  brave: boolean;
  parallel: boolean;
  tavily: boolean;
  perplexity: boolean;
  exa: boolean;
  gemini: boolean;
}

interface SummaryModel {
  value: string;
  label: string;
}

interface InlineData {
  queries: string[];
  sessionToken: string;
  timeout: number;
  defaultProvider: string;
  searchProvider: string;
  summaryModels: SummaryModel[];
  defaultSummaryModel: string | null;
  availableProviders: ProviderStatus;
}

interface SearchResult {
  title: string;
  url: string;
  domain: string;
}

interface QuerySlot {
  slotId: number;
  query: string;
  completed?: boolean;
  answer?: string;
  results?: SearchResult[];
  error?: string;
  provider?: string;
  checked?: boolean;
}

interface SummaryMeta {
  model: string | null;
  durationMs: number;
  tokenEstimate: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  edited: boolean;
}

// Access injected data safely
const rawWindow = window as any;
const DATA: InlineData = rawWindow.DATA || {
  queries: ["Artificial General Intelligence", "Vite vs NextJS"],
  sessionToken: "dummy-token",
  timeout: 300,
  defaultProvider: "exa",
  searchProvider: "exa",
  summaryModels: [
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro" }
  ],
  defaultSummaryModel: "openai/gpt-4o",
  availableProviders: {
    openai: true,
    brave: true,
    parallel: true,
    tavily: true,
    perplexity: true,
    exa: true,
    gemini: true
  }
};

export default function App() {
  // --- STATE ---
  const [sessionToken] = useState<string>(DATA.sessionToken);
  const [timeoutSec, setTimeoutSec] = useState<number>(DATA.timeout);
  const [timeLeft, setTimeLeft] = useState<number>(DATA.timeout);
  const [isAdjustingTimer, setIsAdjustingTimer] = useState<boolean>(false);
  const [timerInputVal, setTimerInputVal] = useState<string>(String(DATA.timeout));

  const [currentProvider, setCurrentProvider] = useState<string>(DATA.defaultProvider);
  const [slots, setSlots] = useState<QuerySlot[]>(() => 
    DATA.queries.map((q, idx) => ({
      slotId: idx,
      query: q,
      checked: true,
      completed: false,
      provider: DATA.defaultProvider
    }))
  );

  const [searchesDone, setSearchesDone] = useState<boolean>(DATA.queries.length === 0);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [submitInFlight, setSubmitInFlight] = useState<boolean>(false);
  const [timerExpired, setTimerExpired] = useState<boolean>(false);
  const [closeCountdown, setCloseCountdown] = useState<number>(5);

  const [stage, setStage] = useState<"results" | "generating-summary" | "summary-review">("results");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  
  // Summary configurations
  const [selectedSummaryProvider, setSelectedSummaryProvider] = useState<string>(() => {
    if (DATA.defaultSummaryModel) {
      const slash = DATA.defaultSummaryModel.indexOf('/');
      if (slash > 0) return DATA.defaultSummaryModel.slice(0, slash);
    }
    return "";
  });
  const [selectedSummaryModel, setSelectedSummaryModel] = useState<string>(DATA.defaultSummaryModel || "");
  const [summaryDraft, setSummaryDraft] = useState<string>("");
  const [summaryFeedback, setSummaryFeedback] = useState<string>("");
  const [summaryMeta, setSummaryMeta] = useState<SummaryMeta | null>(null);

  // Search input
  const [newSearchQuery, setNewSearchQuery] = useState<string>("");
  const [addSearchInFlight, setAddSearchInFlight] = useState<number>(0);
  const [rewriteInFlight, setRewriteInFlight] = useState<boolean>(false);

  // Preview Modal
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [previewPopoverQuote, setPreviewPopoverQuote] = useState<string>("");
  const [previewPopoverInput, setPreviewPopoverInput] = useState<string>("");
  const [previewPopoverX, setPreviewPopoverX] = useState<number>(0);
  const [previewPopoverY, setPreviewPopoverY] = useState<number>(0);

  // Result Detail Modal
  const [activeResultSlot, setActiveResultSlot] = useState<QuerySlot | null>(null);

  const lastInteraction = useRef<number>(Date.now());
  const summaryRequestSeq = useRef<number>(0);
  const lastAutoSummarySignature = useRef<string>("");

  // Helpers
  const touchInteraction = () => {
    lastInteraction.current = Date.now();
  };

  // --- SUMMARY PROVIDERS SETUP ---
  const summaryModelsByProvider: Record<string, SummaryModel[]> = {};
  const summaryProviders: string[] = [];
  
  DATA.summaryModels.forEach(m => {
    if (!m || typeof m.value !== 'string') return;
    const val = m.value.trim();
    const slash = val.indexOf('/');
    if (slash <= 0) return;
    const prov = val.slice(0, slash);
    if (!summaryModelsByProvider[prov]) {
      summaryModelsByProvider[prov] = [];
      summaryProviders.push(prov);
    }
    summaryModelsByProvider[prov].push(m);
  });

  // Init models
  useEffect(() => {
    if (summaryProviders.length > 0 && !selectedSummaryProvider) {
      let defaultProv = summaryProviders[0];
      let defaultMod = summaryModelsByProvider[defaultProv][0].value;

      if (DATA.defaultSummaryModel) {
        const slash = DATA.defaultSummaryModel.indexOf('/');
        if (slash > 0) {
          const prov = DATA.defaultSummaryModel.slice(0, slash);
          if (summaryProviders.includes(prov)) {
            defaultProv = prov;
            defaultMod = DATA.defaultSummaryModel;
          }
        }
      }
      setSelectedSummaryProvider(defaultProv);
      setSelectedSummaryModel(defaultMod);
    }
  }, [summaryProviders, selectedSummaryProvider]);

  // --- IDLE TIMER LOGIC ---
  const resetTimer = () => {
    lastInteraction.current = Date.now();
    setTimeLeft(timeoutSec);
  };

  // Listen for user interaction events to reset idle timer
  useEffect(() => {
    const events = ["click", "keydown", "input", "change", "scroll", "mousemove"];
    const handleEvent = () => resetTimer();

    events.forEach(evt => {
      document.addEventListener(evt, handleEvent, { passive: true });
    });

    return () => {
      events.forEach(evt => {
        document.removeEventListener(evt, handleEvent);
      });
    };
  }, [timeoutSec]);

  // Countdown timer ticking down based on idle status
  useEffect(() => {
    const timerInterval = setInterval(() => {
      if (submitted || timerExpired) return;
      
      const idleSec = Math.floor((Date.now() - lastInteraction.current) / 1000);
      const remaining = Math.max(0, timeoutSec - idleSec);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timerInterval);
        handleTimeout();
      }
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [timeoutSec, submitted, timerExpired]);

  // Periodic heartbeat
  useEffect(() => {
    const heartbeatInterval = setInterval(() => {
      if (submitted) return;
      postJson("/heartbeat", {
        idleMs: Math.max(0, Date.now() - lastInteraction.current),
        timeoutSec: timeoutSec,
      }).catch(() => {});
    }, 10000);

    return () => clearInterval(heartbeatInterval);
  }, [timeoutSec, submitted]);

  // Handle Height changes
  useEffect(() => {
    let lastHeight = 0;
    const interval = setInterval(() => {
      if (!rawWindow.glimpse || typeof rawWindow.glimpse.send !== 'function') return;
      const h = document.documentElement.scrollHeight || document.body.scrollHeight;
      if (h > 0 && Math.abs(h - lastHeight) > 30) {
        lastHeight = h;
        rawWindow.glimpse.send({ type: "resize", height: h });
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // --- SSE EVENT SUBSCRIBER ---
  useEffect(() => {
    const es = new EventSource(`/events?session=${encodeURIComponent(sessionToken)}`);

    es.addEventListener("result", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setSlots(prev => prev.map(s => {
        if (s.slotId === data.queryIndex) {
          const updated = {
            ...s,
            completed: true,
            answer: data.answer || "",
            results: data.results || [],
            provider: data.provider || s.provider
          };
          setActiveResultSlot(curr => curr && curr.slotId === data.queryIndex ? updated : curr);
          return updated;
        }
        return s;
      }));
    });

    es.addEventListener("search-error", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setSlots(prev => prev.map(s => {
        if (s.slotId === data.queryIndex) {
          const updated = {
            ...s,
            completed: true,
            error: data.error || "Search failed",
            provider: data.provider || s.provider
          };
          setActiveResultSlot(curr => curr && curr.slotId === data.queryIndex ? updated : curr);
          return updated;
        }
        return s;
      }));
    });

    es.addEventListener("done", () => {
      setSearchesDone(true);
    });

    return () => es.close();
  }, [sessionToken]);

  // Check if searches are completed to trigger auto summary
  useEffect(() => {
    if (searchesDone && stage === "results") {
      const hasPending = slots.some(s => !s.completed) || addSearchInFlight > 0;
      if (!hasPending) {
        const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
        if (checked.length > 0) {
          const sig = checked.slice().sort((a,b)=>a-b).join(",");
          if (sig !== lastAutoSummarySignature.current) {
            lastAutoSummarySignature.current = sig;
            triggerSummaryGeneration(checked);
          }
        }
      }
    }
  }, [searchesDone, slots, stage, addSearchInFlight]);

  // Trigger window close on submission success
  useEffect(() => {
    if (submitted) {
      const t = setTimeout(() => {
        window.close();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [submitted]);

  // Timer countdown close (window close)
  useEffect(() => {
    if (timerExpired && closeCountdown > 0) {
      const interval = setInterval(() => {
        setCloseCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            window.close();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timerExpired, closeCountdown]);

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (submitted || timerExpired || submitInFlight) return;
      
      const target = e.target as HTMLElement;
      const isInteractive = target && (
        target.tagName === "INPUT" || 
        target.tagName === "TEXTAREA" || 
        target.tagName === "SELECT" || 
        target.tagName === "BUTTON" ||
        target.isContentEditable
      );

      if (e.key === "Escape") {
        e.preventDefault();
        if (activeResultSlot) {
          setActiveResultSlot(null);
        } else if (stage === "summary-review") {
          setStage("results");
          setErrorMsg("");
        } else if (stage === "results") {
          handleCancel();
        }
        return;
      }

      if (isInteractive) {
        if (target.tagName === "TEXTAREA" && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          if (stage === "summary-review") {
            handleApprove();
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        if (stage === "results") {
          e.preventDefault();
          const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
          triggerSummaryGeneration(checked);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (stage === "summary-review") {
          e.preventDefault();
          handleApprove();
        }
        return;
      }

      if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (stage === "results") {
          toggleSelectAll();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slots, stage, submitted, timerExpired, submitInFlight, activeResultSlot]);

  // --- API CALL HELPERS ---
  const post = (path: string, body: any) => {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken, ...body }),
    });
  };

  const postJson = async (path: string, body: any) => {
    const res = await post(path, body);
    const raw = await res.text();
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON response from ${path}`);
      }
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  };

  // --- ACTIONS ---
  const handleTimeout = () => {
    setTimerExpired(true);
    postJson("/cancel", { reason: "timeout" }).catch(() => {});
  };

  const adjustTimer = () => {
    const sec = parseInt(timerInputVal, 10);
    if (!isNaN(sec) && sec > 0) {
      setTimeoutSec(sec);
      setTimeLeft(sec);
      setIsAdjustingTimer(false);
    }
  };

  const toggleSelectAll = () => {
    touchInteraction();
    const allChecked = slots.every(s => s.checked);
    setSlots(prev => prev.map(s => ({ ...s, checked: !allChecked })));
  };

  const toggleSlotChecked = (slotId: number) => {
    touchInteraction();
    setSlots(prev => prev.map(s => s.slotId === slotId ? { ...s, checked: !s.checked } : s));
  };

  const handleProviderChange = async (prov: string) => {
    touchInteraction();
    setCurrentProvider(prov);
    try {
      await postJson("/provider", { provider: prov });
    } catch (err: any) {
      setErrorMsg(`Failed to change provider: ${err.message}`);
    }
  };

  const handleAddSearch = async () => {
    if (!newSearchQuery.trim()) return;
    touchInteraction();
    const query = newSearchQuery.trim();
    setNewSearchQuery("");
    
    const newSlotId = slots.length;
    setSlots(prev => [...prev, {
      slotId: newSlotId,
      query,
      checked: true,
      completed: false,
      provider: currentProvider
    }]);

    setAddSearchInFlight(prev => prev + 1);
    try {
      const data = await postJson("/search", { query, provider: currentProvider });
      setSlots(prev => prev.map(s => {
        if (s.slotId === newSlotId) { // Find the newly created slot in state
          return {
            ...s,
            slotId: data.queryIndex, // Re-map slotId to the index returned from the server
            completed: true,
            answer: data.answer || "",
            results: data.results || [],
            error: data.error || undefined, // Map backend error if it occurred
            provider: data.provider || s.provider
          };
        }
        return s;
      }));
    } catch (err: any) {
      setSlots(prev => prev.map(s => {
        if (s.slotId === newSlotId) {
          return {
            ...s,
            completed: true,
            error: err.message || "Search failed"
          };
        }
        return s;
      }));
    } finally {
      setAddSearchInFlight(prev => Math.max(0, prev - 1));
    }
  };

  const handleRewrite = async () => {
    if (!newSearchQuery.trim() || rewriteInFlight) return;
    touchInteraction();
    setRewriteInFlight(true);
    try {
      const data = await postJson("/rewrite", { query: newSearchQuery.trim() });
      if (data && data.query) {
        setNewSearchQuery(data.query);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to rewrite query: ${err.message}`);
    } finally {
      setRewriteInFlight(false);
    }
  };

  const handleTryAltProvider = async (slotId: number, query: string, altProvider: string) => {
    touchInteraction();
    const searchingSlot = {
      slotId,
      query,
      completed: false,
      error: undefined,
      provider: altProvider
    };
    setSlots(prev => prev.map(s => s.slotId === slotId ? searchingSlot : s));
    setActiveResultSlot(curr => curr && curr.slotId === slotId ? searchingSlot : curr);

    try {
      const data = await postJson("/search", { query, provider: altProvider });
      const completedSlot = {
        slotId,
        query,
        completed: true,
        answer: data.answer || "",
        results: data.results || [],
        error: data.error || undefined,
        provider: data.provider || altProvider
      };
      setSlots(prev => prev.map(s => s.slotId === slotId ? completedSlot : s));
      setActiveResultSlot(curr => curr && curr.slotId === slotId ? completedSlot : curr);
    } catch (err: any) {
      const failedSlot = {
        slotId,
        query,
        completed: true,
        error: err.message || "Alternative search failed",
        provider: altProvider
      };
      setSlots(prev => prev.map(s => s.slotId === slotId ? failedSlot : s));
      setActiveResultSlot(curr => curr && curr.slotId === slotId ? failedSlot : curr);
    }
  };

  const triggerSummaryGeneration = async (selectedIndices: number[], feedback?: string) => {
    if (submitted || timerExpired || submitInFlight) return;
    setErrorMsg("");
    setStage("generating-summary");
    const reqSeq = ++summaryRequestSeq.current;

    const payload: any = { selected: selectedIndices };
    if (selectedSummaryModel) payload.model = selectedSummaryModel;
    if (feedback) payload.feedback = feedback;

    try {
      const data = await postJson("/summarize", payload);
      if (reqSeq !== summaryRequestSeq.current) return;
      
      setSummaryDraft(data.summary || "");
      setSummaryFeedback("");
      setSummaryMeta(data.meta || null);
      setStage("summary-review");
    } catch (err: any) {
      if (reqSeq !== summaryRequestSeq.current) return;
      setErrorMsg(`Failed to generate summary: ${err.message}`);
      setStage("results");
    }
  };

  const handleRegenerate = () => {
    const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
    triggerSummaryGeneration(checked, summaryFeedback);
  };

  const handleSendRaw = async () => {
    touchInteraction();
    setSubmitInFlight(true);
    const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
    try {
      await postJson("/submit", {
        selected: checked,
        rawResults: true
      });
      setSuccessMsg("Results approved and submitted.");
      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(`Submission failed: ${err.message}`);
    } finally {
      setSubmitInFlight(false);
    }
  };

  const handleApprove = async () => {
    touchInteraction();
    setSubmitInFlight(true);
    const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
    try {
      await postJson("/submit", {
        selected: checked,
        summary: summaryDraft,
        summaryMeta
      });
      setSuccessMsg("Summary approved and submitted.");
      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(`Submission failed: ${err.message}`);
    } finally {
      setSubmitInFlight(false);
    }
  };

  const handleCancel = async () => {
    try {
      await postJson("/cancel", { reason: "user" });
      setSuccessMsg("Session cancelled.");
      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(`Cancel failed: ${err.message}`);
    }
  };

  // Text selection feedback popover helper
  const handleTextSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const txt = sel.toString().trim();
    if (!txt || txt.length < 4) {
      setPreviewPopoverQuote("");
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setPreviewPopoverQuote(txt);
    setPreviewPopoverX(rect.left + window.scrollX + rect.width / 2);
    setPreviewPopoverY(rect.top + window.scrollY - 10);
  };

  const handlePopoverRegenerate = () => {
    if (!previewPopoverQuote) return;
    const checked = slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId);
    const finalFeedback = `Regarding quote: "${previewPopoverQuote}" -> ${previewPopoverInput}`;
    setIsPreviewOpen(false);
    setPreviewPopoverQuote("");
    setPreviewPopoverInput("");
    triggerSummaryGeneration(checked, finalFeedback);
  };

  // --- RENDERING HELPERS ---
  const formatTimeStr = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const providers = ["openai", "exa", "brave", "parallel", "tavily", "perplexity", "gemini"];
  const providerLabel = (p: string) => {
    const labels: Record<string, string> = {
      openai: "OpenAI",
      exa: "Exa",
      brave: "Brave",
      parallel: "Parallel",
      tavily: "Tavily",
      perplexity: "Perplexity",
      gemini: "Gemini"
    };
    return labels[p] || p;
  };

  const hasPendingSearches = slots.some(s => !s.completed) || addSearchInFlight > 0;

  return (
    <div className="min-h-screen bg-black text-foreground font-sans relative flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Timer Badge */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        {isAdjustingTimer ? (
          <div className="bg-secondary border border-border flex items-center p-1 font-mono text-xs">
            <input 
              type="text" 
              value={timerInputVal} 
              onChange={e => setTimerInputVal(e.target.value)}
              className="bg-black text-foreground w-12 text-center outline-none border-none py-0.5"
            />
            <span className="px-1 text-muted-foreground">s</span>
            <button 
              onClick={adjustTimer} 
              className="bg-primary text-primary-foreground px-2 py-0.5 hover:opacity-90 font-bold"
            >
              SET
            </button>
            <button 
              onClick={() => setIsAdjustingTimer(false)}
              className="px-1 text-muted-foreground hover:text-foreground ml-1"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button 
            onClick={() => {
              setTimerInputVal(String(timeLeft));
              setIsAdjustingTimer(true);
            }}
            className={`border border-border px-3 py-1 font-mono text-xs flex items-center gap-2 hover:bg-secondary transition-all ${
              timeLeft < 30 ? 'text-destructive border-destructive animate-pulse' : 'text-muted-foreground'
            }`}
          >
            <Clock size={12} />
            <span>{formatTimeStr(timeLeft)}</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <main className="max-w-4xl w-full mx-auto px-6 py-12 flex-1 flex flex-col gap-8">
        
        {/* Error Banner */}
        {errorMsg && (
          <div className="border border-destructive bg-destructive/10 p-4 flex items-start gap-3">
            <AlertCircle className="text-destructive shrink-0 mt-0.5" size={16} />
            <div className="flex-1 text-sm font-mono text-destructive">
              {errorMsg}
            </div>
            <button onClick={() => setErrorMsg("")} className="text-destructive hover:opacity-80">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Hero Section */}
        <div className="border-b border-border pb-6 flex flex-col gap-3">
          <div className="text-xs uppercase font-mono tracking-widest text-muted-foreground">Web Search Curator</div>
          <h1 className="text-4xl font-bold tracking-tight">
            {hasPendingSearches ? "Curating Search Results..." : "Review Search Results"}
          </h1>
          <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
            <span className="text-sm text-muted-foreground font-mono">
              Status: {hasPendingSearches ? "Searching..." : "Ready"}
            </span>
            
            <div className="flex items-center gap-1.5 border border-border p-0.5">
              {providers.map(p => {
                if (!DATA.availableProviders[p as keyof ProviderStatus]) return null;
                const isSelected = currentProvider === p;
                return (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className={`font-mono text-xs px-2.5 py-1 uppercase transition-all ${
                      isSelected 
                        ? 'bg-primary text-primary-foreground font-bold' 
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {providerLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Result Cards */}
        <div className="flex flex-col gap-4">
          {slots.map(s => {
            const hasData = s.completed && !s.error;
            return (
              <div 
                key={s.slotId}
                className={`border transition-all duration-200 ${
                  s.checked 
                    ? 'border-white/20 bg-secondary/20' 
                    : 'border-border bg-black'
                }`}
              >
                {/* Card Header & Compact Layout */}
                <div className="p-4 flex items-center justify-between gap-4 select-none">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={!!s.checked}
                      disabled={!s.completed || !!s.error}
                      onChange={() => toggleSlotChecked(s.slotId)}
                      className="size-4 rounded-none accent-white cursor-pointer shrink-0"
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-mono text-sm font-semibold text-foreground truncate">{s.query}</h3>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 uppercase shrink-0 border ${
                          s.completed 
                            ? s.error 
                              ? 'border-destructive/40 text-destructive bg-destructive/5' 
                              : 'border-white/20 text-muted-foreground' 
                            : 'border-cyan-500/20 text-cyan-400 bg-cyan-950/10 animate-pulse'
                        }`}>
                          {s.completed ? s.error ? "Failed" : providerLabel(s.provider || "") : "Searching"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {!s.completed && <span>Stream active...</span>}
                        {s.completed && s.error && <span>{s.error}</span>}
                        {s.completed && !s.error && s.results && (
                          <span>{s.results.length} sources found</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {hasData && (
                    <button
                      onClick={() => setActiveResultSlot(s)}
                      className="border border-border hover:border-white/20 bg-secondary/20 hover:bg-secondary px-3.5 py-1.5 font-mono text-xs uppercase transition-all shrink-0 font-medium"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Send Raw Row */}
        {stage === "results" && (
          <div className="flex justify-end">
            <button
              onClick={handleSendRaw}
              disabled={submitInFlight || slots.filter(s => s.checked && s.completed && !s.error).length === 0}
              className="border border-border px-4 py-2 hover:bg-secondary font-mono text-xs uppercase transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              Send selected results without summary
            </button>
          </div>
        )}

        {/* Add Search Bar */}
        <div className="border border-border flex items-center p-2 bg-secondary/10">
          <Search size={16} className="text-muted-foreground ml-2 shrink-0" />
          <input
            type="text"
            placeholder="Add a search query..."
            value={newSearchQuery}
            onChange={e => setNewSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddSearch()}
            className="flex-1 bg-transparent text-sm border-none outline-none px-3 py-1.5 text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={handleRewrite}
            disabled={!newSearchQuery.trim() || rewriteInFlight}
            className="p-2 border border-border hover:border-white/20 text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
            title="Rewrite query with AI"
          >
            <Sparkles size={14} className={rewriteInFlight ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleAddSearch}
            disabled={!newSearchQuery.trim()}
            className="ml-2 bg-primary text-primary-foreground font-mono text-xs font-semibold px-4 py-2 hover:opacity-90 transition-all disabled:opacity-50"
          >
            SEARCH
          </button>
        </div>

        {/* Summary Review Panel */}
        {stage === "summary-review" && (
          <div className="border border-border bg-secondary/5 flex flex-col gap-4 p-6">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4 flex-wrap">
              <div>
                <h2 className="text-lg font-bold">Review Summary Draft</h2>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">Edit the generated summary below.</p>
              </div>
              <div className="flex items-center gap-2 border border-border p-0.5">
                <select
                  value={selectedSummaryProvider}
                  onChange={e => {
                    const prov = e.target.value;
                    setSelectedSummaryProvider(prov);
                    if (summaryModelsByProvider[prov]) {
                      setSelectedSummaryModel(summaryModelsByProvider[prov][0].value);
                    }
                  }}
                  className="bg-black text-foreground font-mono text-xs border-none outline-none py-1 px-2.5"
                >
                  {summaryProviders.map(p => (
                    <option key={p} value={p}>{p.toUpperCase()}</option>
                  ))}
                </select>
                <select
                  value={selectedSummaryModel}
                  onChange={e => setSelectedSummaryModel(e.target.value)}
                  className="bg-black text-foreground font-mono text-xs border-none outline-none py-1 px-2.5"
                >
                  {selectedSummaryProvider && summaryModelsByProvider[selectedSummaryProvider]?.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <textarea
              value={summaryDraft}
              onChange={e => setSummaryDraft(e.target.value)}
              placeholder="Summary draft will appear here..."
              rows={8}
              className="w-full bg-black border border-border p-4 text-sm leading-relaxed text-zinc-300 outline-none focus:border-white/20 font-sans"
            />

            <div className="flex items-center border border-border bg-black/40 p-1.5">
              <input
                type="text"
                value={summaryFeedback}
                onChange={e => setSummaryFeedback(e.target.value)}
                placeholder="Optional feedback for regeneration..."
                className="flex-1 bg-transparent border-none text-xs outline-none px-3 text-foreground"
              />
            </div>

            <div className="flex justify-between items-center flex-wrap gap-4 border-t border-border pt-4">
              <button
                onClick={() => setStage("results")}
                className="border border-border px-4 py-2 hover:bg-secondary font-mono text-xs uppercase"
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRegenerate}
                  className="border border-border px-4 py-2 hover:bg-secondary font-mono text-xs uppercase flex items-center gap-2"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
                <button
                  onClick={() => setIsPreviewOpen(true)}
                  className="border border-border px-4 py-2 hover:bg-secondary font-mono text-xs uppercase flex items-center gap-2"
                >
                  <Eye size={12} />
                  Preview
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitInFlight}
                  className="bg-primary text-primary-foreground px-5 py-2 hover:opacity-90 font-mono text-xs uppercase flex items-center gap-2 font-bold"
                >
                  <Send size={12} />
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generating Summary Placeholder */}
        {stage === "generating-summary" && (
          <div className="border border-white/10 bg-secondary/5 p-8 flex flex-col items-center justify-center gap-4 text-center animate-pulse">
            <RefreshCw className="animate-spin text-muted-foreground" size={24} />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-sm font-semibold">Generating Summary Draft</span>
              <span className="text-xs text-muted-foreground font-mono">Asking model to compile results...</span>
            </div>
          </div>
        )}

      </main>

      {/* Footer / Shortcut Bar */}
      <footer className="border-t border-border bg-black py-4 px-6 flex justify-between items-center text-xs text-muted-foreground font-mono mt-12">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5">
            <kbd className="bg-secondary px-1.5 py-0.5 border border-border text-[10px]">A</kbd>
            <span>Toggle all</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="bg-secondary px-1.5 py-0.5 border border-border text-[10px]">Enter</kbd>
            <span>Generate summary</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="bg-secondary px-1.5 py-0.5 border border-border text-[10px]">Esc</kbd>
            <span>Cancel</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleCancel}
            className="hover:text-foreground uppercase transition-all"
          >
            Cancel Session
          </button>
          
          {stage === "results" && (
            <button
              onClick={() => triggerSummaryGeneration(slots.filter(s => s.checked && s.completed && !s.error).map(s => s.slotId))}
              disabled={slots.filter(s => s.checked && s.completed && !s.error).length === 0 || hasPendingSearches}
              className="bg-primary text-primary-foreground font-bold px-4 py-2 hover:opacity-95 uppercase disabled:opacity-50"
            >
              Generate Summary
            </button>
          )}
        </div>
      </footer>

      {/* Result Detail Modal */}
      {activeResultSlot && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-black border border-border max-w-2xl w-full flex flex-col justify-between max-h-[85vh]">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-sm uppercase tracking-wider font-semibold truncate max-w-md">
                  {activeResultSlot.query}
                </h2>
                <span className="text-[9px] font-mono px-1.5 py-0.5 uppercase shrink-0 border border-white/20 text-muted-foreground">
                  {providerLabel(activeResultSlot.provider || "")}
                </span>
              </div>
              <button 
                onClick={() => setActiveResultSlot(null)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex flex-col gap-6">
              {/* Answer Area */}
              {activeResultSlot.completed && activeResultSlot.answer && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs uppercase font-mono tracking-wider text-muted-foreground">AI Output</h4>
                  <div 
                    className="text-sm leading-relaxed prose prose-invert font-sans max-w-none text-zinc-300"
                    dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(marked.parse(activeResultSlot.answer) as string) }}
                  />
                </div>
              )}

              {/* Sources */}
              {activeResultSlot.results && activeResultSlot.results.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs uppercase font-mono tracking-wider text-muted-foreground">Sources</h4>
                  <div className="flex flex-col gap-2">
                    {activeResultSlot.results.map((r, rIdx) => (
                      <a
                        key={rIdx}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group p-2.5 border border-border hover:border-white/20 bg-secondary/10 flex justify-between items-center transition-all"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-xs text-zinc-300 group-hover:text-foreground truncate font-medium">
                            {r.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono truncate">
                            {r.domain}
                          </span>
                        </div>
                        <ExternalLink size={12} className="text-muted-foreground group-hover:text-foreground shrink-0 ml-4" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Try Alternative Providers / Footer */}
            <div className="p-4 border-t border-border bg-secondary/5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider mr-1">Also try</span>
              {providers
                .filter(p => p !== activeResultSlot.provider && DATA.availableProviders[p as keyof ProviderStatus])
                .map(p => (
                  <button
                    key={p}
                    onClick={() => handleTryAltProvider(activeResultSlot.slotId, activeResultSlot.query, p)}
                    className="text-[10px] font-mono border border-border px-2 py-0.5 hover:border-white/30 text-zinc-400 hover:text-foreground transition-all"
                  >
                    {providerLabel(p)}
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-black border border-border max-w-2xl w-full flex flex-col justify-between max-h-[85vh]">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h2 className="font-mono text-sm uppercase tracking-wider font-semibold">Summary Preview</h2>
              <button onClick={() => setIsPreviewOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            
            <div 
              className="p-6 overflow-y-auto text-sm leading-relaxed prose prose-invert font-sans text-zinc-300 max-w-none"
              onMouseUp={handleTextSelection}
              dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(marked.parse(summaryDraft) as string) }}
            />

            {/* Inline Feedback Popover */}
            {previewPopoverQuote && (
              <div 
                className="absolute bg-black border border-border p-4 max-w-xs shadow-xl flex flex-col gap-2 z-[110]"
                style={{ left: `${Math.min(window.innerWidth - 300, Math.max(20, previewPopoverX - 150))}px`, top: `${previewPopoverY - 140}px` }}
              >
                <div className="text-[10px] font-mono text-muted-foreground uppercase truncate">Quote: "{previewPopoverQuote}"</div>
                <textarea
                  placeholder="Provide correction feedback..."
                  value={previewPopoverInput}
                  onChange={e => setPreviewPopoverInput(e.target.value)}
                  className="bg-secondary/40 border border-border p-1.5 text-xs text-foreground resize-none w-full"
                  rows={2}
                />
                <div className="flex justify-between items-center">
                  <button 
                    onClick={() => setPreviewPopoverQuote("")}
                    className="text-[10px] text-muted-foreground hover:text-foreground uppercase font-mono"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handlePopoverRegenerate}
                    className="bg-primary text-primary-foreground font-mono text-[10px] px-3 py-1 font-bold"
                  >
                    REGEN
                  </button>
                </div>
              </div>
            )}

            <div className="p-4 border-t border-border bg-secondary/5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <select
                  value={selectedSummaryModel}
                  onChange={e => setSelectedSummaryModel(e.target.value)}
                  className="bg-black text-foreground font-mono text-xs border border-border py-1 px-2"
                >
                  {selectedSummaryProvider && summaryModelsByProvider[selectedSummaryProvider]?.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleRegenerate}
                  className="border border-border px-3 py-1 hover:bg-secondary font-mono text-xs uppercase flex items-center gap-1.5"
                >
                  <RefreshCw size={10} />
                  Regenerate
                </button>
              </div>
              <button
                onClick={() => {
                  setIsPreviewOpen(false);
                  handleApprove();
                }}
                disabled={submitInFlight}
                className="bg-primary text-primary-foreground px-5 py-1.5 hover:opacity-90 font-mono text-xs uppercase font-bold"
              >
                Approve & Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Overlay */}
      {submitted && (
        <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center p-6">
          <div className="border border-border max-w-sm w-full p-8 flex flex-col items-center justify-center text-center gap-4 bg-secondary/10">
            <div className="border border-white/20 p-3 bg-secondary/20 font-mono text-sm tracking-wider font-bold">OK</div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold font-mono uppercase tracking-wider">Results Sent</h2>
              <p className="text-xs text-muted-foreground font-mono">{successMsg || "The session completed successfully."}</p>
            </div>
          </div>
        </div>
      )}

      {/* Expired Overlay */}
      {timerExpired && !submitted && (
        <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center p-6">
          <div className="border border-destructive/50 max-w-sm w-full p-8 flex flex-col items-center justify-center text-center gap-4 bg-destructive/5">
            <div className="border border-destructive/30 p-3 bg-destructive/10 font-mono text-sm tracking-wider text-destructive font-bold">!</div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold font-mono uppercase tracking-wider text-destructive">Session Ended</h2>
              <p className="text-xs text-muted-foreground font-mono">Time's up — sending all results to your agent.</p>
              <div className="text-xs text-zinc-400 font-mono mt-2">Closing in {closeCountdown}s</div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function sanitizeMarkdownHtml(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll("script, iframe, object, embed, form, style, link, meta, base")
    .forEach(el => el.remove());

  const nodes = container.querySelectorAll("*");
  nodes.forEach(node => {
    for (let i = node.attributes.length - 1; i >= 0; i--) {
      const attr = node.attributes[i];
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  });

  const anchors = container.querySelectorAll("a[href]");
  anchors.forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    const safe = /^https?:\/\//i.test(href.trim()) ? href.trim() : "#";
    anchor.setAttribute("href", safe);
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.setAttribute("target", "_blank");
  });

  return container.innerHTML;
}
