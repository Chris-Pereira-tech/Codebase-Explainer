import React, { useState, useEffect, useRef } from 'react';
import { ApiResponse } from './components/api';
import './App.css';

// Declare mermaid as a global (loaded via CDN in index.html)
declare const mermaid: {
  initialize: (config: Record<string, unknown>) => void;
  run: (config: { nodes: HTMLElement[] }) => Promise<void>;
};

interface AnalysisData {
  owner: string;
  repo: string;
  fileCount: number;
  overview: string;
  entryPoints: { file: string; why: string }[];
  readingOrder: { file: string; order: number; reason: string }[];
  mermaidDiagram: string;
  generatedAt: string;
}

// Loading messages that cycle during analysis
const LOADING_MESSAGES = [
  'Cloning repository files…',
  'Building dependency graph with madge…',
  'Summarizing source files with LLM…',
  'Generating architecture analysis…',
  'Rendering dependency diagram…',
];

function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    // Reset container
    const el = containerRef.current;
    el.innerHTML = '';
    setError(null);

    // Create a fresh element for mermaid to render into
    const pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.textContent = chart;
    el.appendChild(pre);

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#6366f1',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#818cf8',
          lineColor: '#94a3b8',
          secondaryColor: '#1e293b',
          tertiaryColor: '#0f172a',
          background: '#0f172a',
          mainBkg: '#1e293b',
          nodeBorder: '#6366f1',
          clusterBkg: '#1e293b',
          titleColor: '#f8fafc',
          edgeLabelBackground: '#1e293b',
          nodeTextColor: '#f8fafc',
        },
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
          padding: 15,
          nodeSpacing: 50,
          rankSpacing: 60,
        },
        securityLevel: 'loose',
      });

      mermaid.run({ nodes: [pre] }).catch((err: Error) => {
        console.error('Mermaid render error:', err);
        // Only show fallback if there's no SVG rendered
        if (!el.querySelector('svg')) {
          setError('Diagram rendering failed — showing raw syntax below');
        }
      });
    } catch (err) {
      console.error('Mermaid init error:', err);
      setError('Diagram rendering failed — showing raw syntax below');
    }
  }, [chart]);

  return (
    <div>
      <div ref={containerRef} className="mermaid-render" />
      {error && (
        <div className="mermaid-fallback">
          <p className="mermaid-error">{error}</p>
          <pre className="mermaid-raw">{chart}</pre>
        </div>
      )}
    </div>
  );
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  // Cycle loading messages
  useEffect(() => {
    if (!loading) return;
    setLoadingMsgIndex(0);
    const interval = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [loading]);

  const handleAnalyze = async () => {
    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    const githubUrlPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?$/;
    if (!githubUrlPattern.test(repoUrl.trim())) {
      setError('Please enter a valid GitHub URL (https://github.com/owner/repo)');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });

      const result: ApiResponse = await response.json();

      if (!result.success) {
        setError(result.error || 'Analysis failed');
      } else if (result.data) {
        setAnalysis(result.data);
      } else {
        setError('Unexpected response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze repository');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleAnalyze();
    }
  };

  return (
    <div className="app-shell">
      {/* Ambient glow effects */}
      <div className="glow glow-1" />
      <div className="glow glow-2" />

      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="logo-mark">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="10" fill="url(#logo-grad)" />
              <path d="M10 18L18 10L26 18L18 26L10 18Z" stroke="#fff" strokeWidth="2" fill="none" />
              <circle cx="18" cy="18" r="3" fill="#fff" />
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="36" y2="36">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="title">Codebase Explainer</h1>
          <p className="subtitle">
            Paste a public GitHub repo URL to get an instant architecture breakdown — dependency graphs, entry points, and a suggested reading order.
          </p>
        </header>

        {/* Search Card */}
        <div className="card search-card">
          <div className="input-row">
            <div className="input-wrapper">
              <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <input
                id="repo-url-input"
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="https://github.com/owner/repository"
                disabled={loading}
              />
            </div>
            <button
              id="analyze-button"
              onClick={handleAnalyze}
              disabled={loading || !repoUrl.trim()}
              className="analyze-btn"
            >
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  Analyzing
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Analyze
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="error-banner" id="error-message">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {error}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="loading-card card" id="loading-indicator">
            <div className="loading-pulse-ring" />
            <div className="loading-content">
              <div className="loading-spinner-large" />
              <p className="loading-msg" key={loadingMsgIndex}>
                {LOADING_MESSAGES[loadingMsgIndex]}
              </p>
              <p className="loading-sub">This usually takes 15–30 seconds for medium repos</p>
            </div>
          </div>
        )}

        {/* Results */}
        {analysis && (
          <div className="results-grid">
            {/* Repo info bar */}
            <div className="card repo-bar" id="repo-info">
              <div className="repo-identity">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                <span className="repo-name">{analysis.owner}/{analysis.repo}</span>
              </div>
              <div className="repo-meta">
                <span className="badge">{analysis.fileCount} files analyzed</span>
                <span className="badge badge-secondary">{new Date(analysis.generatedAt).toLocaleString()}</span>
              </div>
            </div>

            {/* Overview */}
            <div className="card" id="overview-section">
              <h2 className="card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                Architecture Overview
              </h2>
              <p className="overview-text">{analysis.overview}</p>
            </div>

            {/* Two-column: Entry Points + Reading Order */}
            <div className="two-col">
              <div className="card" id="entry-points-section">
                <h2 className="card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Key Entry Points
                </h2>
                <div className="list-stack">
                  {analysis.entryPoints.map((point, i) => (
                    <div key={i} className="list-item">
                      <span className="list-num">{i + 1}</span>
                      <div>
                        <h4 className="list-file">{point.file}</h4>
                        <p className="list-desc">{point.why}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" id="reading-order-section">
                <h2 className="card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  Suggested Reading Order
                </h2>
                <div className="list-stack">
                  {analysis.readingOrder.map((item) => (
                    <div key={item.order} className="list-item">
                      <span className="list-num order-num">{item.order}</span>
                      <div>
                        <h4 className="list-file">{item.file}</h4>
                        <p className="list-desc">{item.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Mermaid Diagram — full width */}
            <div className="card diagram-card" id="diagram-section">
              <h2 className="card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Dependency Graph
              </h2>
              <MermaidDiagram chart={analysis.mermaidDiagram} />
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="footer">
          Built with Node.js, React &amp; NVIDIA NIM · <a href="https://github.com/Chris-Pereira-tech/Codebase-Explainer" target="_blank" rel="noreferrer">Source</a>
        </footer>
      </div>
    </div>
  );
}

export default App;