import React, { useState } from 'react';
import { ApiResponse } from './components/api';
import './App.css';

interface AnalysisResult {
  overview: string;
  entryPoints: { file: string; why: string }[];
  readingOrder: { file: string; order: number; reason: string }[];
  mermaidDiagram: string;
}

interface AnalysisData extends AnalysisResult {
  owner: string;
  repo: string;
  fileCount: number;
  generatedAt: string;
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);

  const handleAnalyze = async () => {
    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    // Validate GitHub URL format
    const githubUrlPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?$/;
    if (!githubUrlPattern.test(repoUrl.trim())) {
      setError('Please enter a valid GitHub repository URL (https://github.com/owner/repo)');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() })
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Codebase Explainer</h1>
          <p className="text-lg text-gray-600">Analyze any public GitHub repository to get architecture summaries, entry points, and visual diagrams</p>
        </div>

        {/* Input Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="https://github.com/owner/repository"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !repoUrl.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Results Section */}
        {analysis && (
          <div className="space-y-8">
            {/* Repository Info */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Repository: {analysis.owner}/{analysis.repo}</h2>
              <p className="text-gray-600">Analyzed {analysis.fileCount} source files</p>
              <p className="text-sm text-gray-500">Generated: {new Date(analysis.generatedAt).toLocaleString()}</p>
            </div>

            {/* Overview */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Architecture Overview</h3>
              <p className="text-gray-700 leading-relaxed">{analysis.overview}</p>
            </div>

            {/* Entry Points */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Key Entry Points</h3>
              <div className="space-y-3">
                {analysis.entryPoints.map((point, index) => (
                  <div key={index} className="flex items-start">
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium mr-3">
                      {index + 1}
                    </span>
                    <div>
                      <h4 className="font-semibold text-gray-900">{point.file}</h4>
                      <p className="text-gray-600 text-sm">{point.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reading Order */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Suggested Reading Order</h3>
              <div className="space-y-3">
                {analysis.readingOrder.map((item) => (
                  <div key={item.order} className="flex items-center">
                    <span className="bg-gray-200 text-gray-800 px-3 py-1 rounded-full text-sm font-medium mr-4">
                      {item.order}
                    </span>
                    <div>
                      <h4 className="font-semibold text-gray-900">{item.file}</h4>
                      <p className="text-gray-600 text-sm">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Architecture Diagram */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Architecture Diagram</h3>
              <div className="mermaid-content">
                <pre className="mermaid bg-gray-50 p-4 rounded text-sm overflow-x-auto">
                  {analysis.mermaidDiagram}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-gray-500 text-sm">
          <p>Codebase Explainer - Built with Node.js, React, and NVIDIA NIM API</p>
        </div>
      </div>
    </div>
  );
}

export default App;