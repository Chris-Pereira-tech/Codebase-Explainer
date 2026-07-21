import express from 'express';
import { Octokit } from '@octokit/rest';
import madge from 'madge';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'codebase-explainer/0.1.0'
});

// Rate limiting state for NIM API
const NIM_RATE_LIMIT = 40; // requests per minute
const NIM_DELAY = 60000 / NIM_RATE_LIMIT; // delay between calls in ms
let lastNIMCall = 0;

// Mock LLM mode - returns realistic fake data for testing
const USE_MOCK_LLM = process.env.USE_MOCK_LLM === 'true';

// Mock file summary generator
function generateMockFileSummary(file: {name: string; content: string; path: string}): string {
  const fileType = file.name.split('.').pop()?.toLowerCase();
  const summaries: Record<string, string> = {
    'ts': `TypeScript source file that implements core logic for the ${file.name.replace(/\.[^.]+$/, '')} module, including type definitions and exported utilities.`,
    'tsx': `React component (${file.name.replace(/\.[^.]+$/, '')}) providing interactive UI elements with state management and event handling.`,
    'js': `JavaScript module containing application logic and exported functions for the ${file.name.replace(/\.[^.]+$/, '')} feature.`,
    'jsx': `React component using JSX for declarative UI rendering of the ${file.name.replace(/\.[^.]+$/, '')} view.`,
    'json': `Configuration file (${file.name}) defining project settings, dependencies, or structured data.`,
    'md': `Markdown documentation file providing project information and usage instructions.`,
    'css': `Stylesheet defining visual appearance rules for the ${file.name.replace(/\.[^.]+$/, '')} component.`,
    'html': `HTML template providing the structural markup for the application.`,
    'yml': `YAML configuration file for CI/CD, deployment, or project settings.`,
    'yaml': `YAML configuration file for CI/CD, deployment, or project settings.`
  };
  return summaries[fileType || ''] || `Source file '${file.name}' contributing to the codebase architecture.`;
}

// Generate Mermaid diagram directly from the real dependency graph
// Caps at ~15 nodes, picking the most-connected ones (highest in-degree + out-degree)
function generateMermaidFromGraph(dependencyGraph: Record<string, string[]>): string {
  const allNodes = new Set<string>();
  const outDegree: Record<string, number> = {};
  const inDegree: Record<string, number> = {};

  // Collect all nodes and compute degrees
  for (const [src, deps] of Object.entries(dependencyGraph)) {
    allNodes.add(src);
    outDegree[src] = (outDegree[src] || 0) + deps.length;
    for (const dep of deps) {
      allNodes.add(dep);
      inDegree[dep] = (inDegree[dep] || 0) + 1;
    }
  }

  // Rank nodes by total connectivity (in-degree + out-degree)
  const MAX_NODES = 15;
  let selectedNodes: Set<string>;

  if (allNodes.size <= MAX_NODES) {
    selectedNodes = allNodes;
  } else {
    const ranked = [...allNodes].sort((a, b) => {
      const scoreA = (inDegree[a] || 0) + (outDegree[a] || 0);
      const scoreB = (inDegree[b] || 0) + (outDegree[b] || 0);
      return scoreB - scoreA;
    });
    selectedNodes = new Set(ranked.slice(0, MAX_NODES));
  }

  // Build stable node-ID map (alphabetical order for determinism)
  const sortedNodes = [...selectedNodes].sort();
  const nodeId: Record<string, string> = {};
  sortedNodes.forEach((node, i) => {
    nodeId[node] = `N${i}`;
  });

  // Build Mermaid lines
  const lines: string[] = ['graph TD'];

  // Declare every selected node with a readable label (basename)
  for (const node of sortedNodes) {
    const label = node.replace(/\\/g, '/');  // normalise separators
    lines.push(`    ${nodeId[node]}["${label}"]`);
  }

  // Emit one edge per real dependency (only between selected nodes)
  for (const [src, deps] of Object.entries(dependencyGraph)) {
    if (!selectedNodes.has(src)) continue;
    for (const dep of deps) {
      if (!selectedNodes.has(dep)) continue;
      lines.push(`    ${nodeId[src]} --> ${nodeId[dep]}`);
    }
  }

  return lines.join('\n');
}

// Mock analysis generator
function generateMockAnalysis(sourceFiles: {name: string; content: string; path: string}[], dependencyGraph: Record<string, string[]>): any {
  const entryPoints = sourceFiles.slice(0, 5).map((f, i) => ({
    file: f.name,
    why: `Key entry point ${i + 1} — serves as a primary interface for the ${f.name.replace(/\.[^.]+$/, '')} module.`
  }));

  const readingOrder = sourceFiles.slice(0, 5).map((f, i) => ({
    file: f.name,
    order: i + 1,
    reason: `Read ${i === 0 ? 'first' : 'next'} to understand the ${f.name.replace(/\.[^.]+$/, '')} layer before dependent modules.`
  }));

  return {
    overview: `This ${sourceFiles.length}-file codebase implements a web application with a Node.js/Express backend and React frontend. The architecture follows a client-server pattern with API integration for code analysis and visualization.`,
    entryPoints: entryPoints.length > 0 ? entryPoints : [{ file: 'server.ts', why: 'Main backend entry point' }],
    readingOrder
  };
}


// Delay to respect rate limits
async function respectRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCall = now - lastNIMCall;
  if (timeSinceLastCall < NIM_DELAY) {
    await new Promise(resolve => setTimeout(resolve, NIM_DELAY - timeSinceLastCall));
  }
  lastNIMCall = Date.now();
}

// Validate GitHub repo URL and extract owner/repo
function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github.com\/([^\/]+)\/([^\/]+)(?:\.git)?$/);
  if (!match) {
    throw new Error('Invalid GitHub URL. Must be in format: https://github.com/owner/repo');
  }
  return {
    owner: match[1],
    repo: match[2]
  };
}

// Get repository's default branch
async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch || 'main';
  } catch (error) {
    console.warn('Could not fetch default branch, falling back to main:', error);
    return 'main';
  }
}

// Get repository file tree
async function getRepoFileTree(owner: string, repo: string, defaultBranch: string): Promise<any[]> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '',
      ref: defaultBranch
    });

    if (Array.isArray(data)) {
      return data;
    } else {
      return [data];
    }
  } catch (error) {
    console.error('Error fetching repo contents:', error);
    throw new Error('Failed to fetch repository contents');
  }
}

// Filter and fetch source files
async function fetchSourceFiles(owner: string, repo: string, items: any[], defaultBranch: string): Promise<{name: string; content: string; path: string}[]> {
  const sourceFiles = [];
  const excludedPatterns = ['.git', 'node_modules', 'dist', 'build', '*.lock', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp'];

  for (const item of items) {
    if (item.type === 'file') {
      const isExcluded = excludedPatterns.some(pattern => {
        if (pattern.startsWith('*.')) {
          return item.name.endsWith(pattern.substring(1));
        }
        return item.name.includes(pattern);
      });

      if (!isExcluded && isSourceFile(item.name)) {
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: item.path || item.name,
            ref: defaultBranch
          });

          let content: string;
          if (Array.isArray(data)) {
            continue; // skip directories
          } else if (data.type === 'file' && data.content) {
            content = Buffer.from(data.content, 'base64').toString('utf8');
          } else {
            continue; // skip symlinks, submodules, or files without content
          }

          sourceFiles.push({
            name: item.name,
            content,
            path: item.path || item.name
          });
        } catch (error) {
          console.warn(`Failed to fetch ${item.name}:`, error);
          // Continue without this file
        }
      }
    } else if (item.type === 'dir' && !item.name.includes('.')) {
      try {
        const subItems = await octokit.repos.getContent({
          owner,
          repo,
          path: item.path || item.name,
          ref: defaultBranch
        });

        const subArray = Array.isArray(subItems.data) ? subItems.data : [subItems.data];
        const nestedFiles = await fetchSourceFiles(owner, repo, subArray, defaultBranch);
        sourceFiles.push(...nestedFiles);
      } catch (error) {
        console.warn(`Failed to process directory ${item.name}:`, error);
      }
    }
  }

  return sourceFiles;
}

// Check if a file is a source code file
function isSourceFile(filename: string): boolean {
  const sourceExtensions = [
    '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.txt', '.yml', '.yaml',
    '.toml', '.cfg', '.ini', '.env', '.sql', '.html', '.css', '.scss',
    '.less', '.styl', '.vue', '.svelte', '.prisma', '.graphqls', '.graphql'
  ];

  const lowerName = filename.toLowerCase();
  return sourceExtensions.some(ext => lowerName.endsWith(ext));
}

// Build import dependency graph using madge
// Writes in-memory files to a temp directory so madge can analyze them
async function buildDependencyGraph(sourceFiles: {name: string; content: string; path: string}[]): Promise<Record<string, string[]>> {
  const tmpDir = path.join(os.tmpdir(), `codebase-explainer-${Date.now()}`);

  try {
    // Write fetched source files to temp directory, preserving paths
    for (const file of sourceFiles) {
      const filePath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf8');
    }

    // Run madge against the temp directory (handles both require() and import)
    const result = await madge(tmpDir);
    const rawGraph: Record<string, string[]> = result.obj();

    return rawGraph;
  } catch (error) {
    console.error('Error building dependency graph with madge:', error);
    // Fall back to an empty graph keyed by filename
    const fallback: Record<string, string[]> = {};
    for (const file of sourceFiles) {
      fallback[file.name] = [];
    }
    return fallback;
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Summarize file content with NIM API
async function summarizeFileContent(file: {name: string; content: string; path: string}): Promise<string> {
  // Return mock data if USE_MOCK_LLM is enabled
  if (USE_MOCK_LLM) {
    return generateMockFileSummary(file);
  }

  try {
    await respectRateLimit();

    const prompt = `In 1-2 sentences, what does this file do?\nFile: ${file.name}\n\nContent:\n${file.content}\n\nFocus on the file's primary purpose and main functionality.`;

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const summary = response.data.choices[0]?.message?.content || `Unable to summarize ${file.name}`;
    return summary.trim();
  } catch (error) {
    console.error(`Error summarizing ${file.name}:`, error);
    return `Summary unavailable for ${file.name}`;
  }
}

// Generate analysis with NIM API
async function generateAnalysis(sourceFiles: {name: string; content: string; path: string}[], dependencyGraph: Record<string, string[]>): Promise<any> {
  // Return mock data if USE_MOCK_LLM is enabled
  if (USE_MOCK_LLM) {
    console.log('[MOCK] Generating mock analysis (USE_MOCK_LLM=true)');
    return generateMockAnalysis(sourceFiles, dependencyGraph);
  }

  try {
    await respectRateLimit();

    const fileSummaries = await Promise.all(
      sourceFiles.slice(0, 10).map(async (file) => {
        const summary = await summarizeFileContent(file);
        return { name: file.name, summary };
      })
    );

    const graphJson = JSON.stringify(dependencyGraph, null, 2);
    const summariesJson = JSON.stringify(fileSummaries, null, 2);

    const prompt = `Based on the following dependency graph and file summaries, provide a comprehensive architecture analysis in valid JSON format.\n\nDependency Graph:\n${graphJson}\n\nFile Summaries:\n${summariesJson}\n\nReturn a JSON object with the following structure (no markdown code fences):\n{\n  "overview": "2-3 sentence architecture summary",\n  "entryPoints": [{"file": "filename.ts", "why": "explanation"}],\n  "readingOrder": [{"file": "filename.ts", "order": 1, "reason": "explanation"}]\n}\n\nImportant rules:\n1. Focus on the most important files for understanding the codebase.\n2. Return valid JSON only, no additional text.`;

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const responseContent = response.data.choices[0]?.message?.content || '{}';
    let analysisData = {} as any;

    try {
      let jsonStr = responseContent.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\\s*|\\s*```$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\\s*|\\s*```$/g, '');
      }

      analysisData = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError);
      console.log('Raw response:', responseContent.substring(0, 500));
      throw new Error('Failed to parse architecture analysis');
    }

    return analysisData;
  } catch (error) {
    console.error('Error generating analysis:', error);
    return {
      overview: 'Analysis unavailable due to server error',
      entryPoints: [],
      readingOrder: []
    };
  }
}

// Analyze GitHub repository
app.post('/analyze', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: 'GitHub repository URL is required' });
    }

    const { owner, repo } = parseGitHubUrl(repoUrl);

    console.log(`Analyzing repository: ${owner}/${repo}`);

    // Get repository default branch
    const defaultBranch = await getDefaultBranch(owner, repo);

    // Get repository file tree
    const repoItems = await getRepoFileTree(owner, repo, defaultBranch);

    // Fetch source files (limit for MVP)
    const sourceFiles = await fetchSourceFiles(owner, repo, repoItems, defaultBranch);

    if (sourceFiles.length === 0) {
      return res.status(400).json({ error: 'No source files found in the repository' });
    }

    // Build dependency graph
    const dependencyGraph = await buildDependencyGraph(sourceFiles);

    // Generate analysis (LLM handles overview, entryPoints, readingOrder)
    const analysis = await generateAnalysis(sourceFiles, dependencyGraph);

    // Generate mermaid diagram directly from the real graph (not LLM)
    const mermaidDiagram = generateMermaidFromGraph(dependencyGraph);

    res.json({
      success: true,
      data: {
        owner,
        repo,
        fileCount: sourceFiles.length,
        overview: analysis.overview || 'Analysis unavailable',
        entryPoints: analysis.entryPoints || [],
        readingOrder: analysis.readingOrder || [],
        mermaidDiagram,
        dependencyGraph,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during analysis',
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Codebase Explainer backend running on port ${PORT}`);
});

export default app;