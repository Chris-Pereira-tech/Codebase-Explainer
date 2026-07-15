import express from 'express';
import { Octokit } from '@octokit/rest';
import madge from 'madge';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs/promises';
import path from 'path';

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

// Get free tier rate limit to check if we're over limit
async function checkRateLimit(): Promise<boolean> {
  try {
    const response = await axios.get('https://integrate.api.nvidia.com/v1/status');
    const usage = response.data?.usage || {};
    return (usage.remaining || 0) > 10; // conservative threshold
  } catch {
    return true; // assume we can proceed if we can't check
  }
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

// Get repository file tree
async function getRepoFileTree(owner: string, repo: string): Promise<any[]> {
  try {
    const { data } = await octokit.repos.getContents({
      owner,
      repo,
      ref: 'main'
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
async function fetchSourceFiles(owner: string, repo: string, items: any[]): Promise<{name: string; content: string; path: string}[]> {
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
            ref: 'main'
          });

          let content: string;
          if (typeof data === 'string') {
            content = Buffer.from(data, 'base64').toString('utf8');
          } else {
            content = Buffer.from(data.content, 'base64').toString('utf8');
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
        const subItems = await octokit.repos.getContents({
          owner,
          repo,
          path: item.path || item.name,
          ref: 'main'
        });

        const subArray = Array.isArray(subItems.data) ? subItems.data : [subItems.data];
        const nestedFiles = await fetchSourceFiles(owner, repo, subArray);
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

// Build import dependency graph
async function buildDependencyGraph(sourceFiles: {name: string; content: string; path: string}[]): Promise<Record<string, string[]>> {
  const graph: Record<string, string[]> = {};

  for (const file of sourceFiles) {
    const dependencies: string[] = [];
    const content = file.content;
    const filename = file.name;

    // Extract import statements
    const importRegex = /import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];

      // Resolve relative paths
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const relativeSource = sourceFiles.find(f => {
          const fPath = f.path.replace(/\/\w+\.\w+$/, '');
          const importPathResolved = path.resolve(fPath, importPath);
          const targetPath = path.resolve(fPath, f.name);
          return importPathResolved === targetPath;
        });

        if (relativeSource) {
          dependencies.push(relativeSource.name);
        }
      } else if (!importPath.startsWith('http') && !importPath.startsWith('https') && !importPath.includes('node_modules')) {
        // Local module
        const localSource = sourceFiles.find(f => f.name === importPath || f.path === importPath);
        if (localSource) {
          dependencies.push(localSource.name);
        }
      }
    }

    graph[filename] = dependencies;
  }

  return graph;
}

// Summarize file content with NIM API
async function summarizeFileContent(file: {name: string; content: string; path: string}): Promise<string> {
  try {
    // Check if we should proceed with NIM call
    const canProceed = await checkRateLimit();
    if (!canProceed) {
      await new Promise(resolve => setTimeout(resolve, 60000)); // wait 1 minute
      return `Summary skipped for ${file.name} (rate limited)`;
    }

    await respectRateLimit();

    const prompt = `In 1-2 sentences, what does this file do?\nFile: ${file.name}\n\nContent:\n${file.content}\n\nFocus on the file's primary purpose and main functionality.`;

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.NIM_API_KEY}`,\n        'Content-Type': 'application/json'
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

    const prompt = `Based on the following dependency graph and file summaries, provide a comprehensive architecture analysis in valid JSON format.\n\nDependency Graph:\n${graphJson}\n\nFile Summaries:\n${summariesJson}\n\nReturn a JSON object with the following structure (no markdown code fences):\n{\n  "overview": "2-3 sentence architecture summary",\n  "entryPoints": [{"file": "filename.ts", "why": "explanation"}],\n  "readingOrder": [{"file": "filename.ts", "order": 1, "reason": "explanation"}],\n  "mermaidDiagram": "graph TD; A[File A] --> B[File B]; B --> C[File C];"
}\n\nImportant rules:\n1. Use ONLY relationships present in the dependency graph - do NOT infer additional ones.\n2. Focus on the most important files for understanding the codebase.\n3. Keep the mermaid diagram readable with ≤12 nodes.\n4. Return valid JSON only, no additional text.\";\n    \n    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.NIM_API_KEY}`,\n        'Content-Type': 'application/json'
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
      readingOrder: [],
      mermaidDiagram: 'graph TD; Error[Analysis Failed] --> Info[Try Again Later];'
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

    // Get repository file tree
    const repoItems = await getRepoFileTree(owner, repo);

    // Fetch source files (limit for MVP)
    const sourceFiles = await fetchSourceFiles(owner, repo, repoItems);

    if (sourceFiles.length === 0) {
      return res.status(400).json({ error: 'No source files found in the repository' });
    }

    // Build dependency graph
    const dependencyGraph = await buildDependencyGraph(sourceFiles);

    // Generate analysis
    const analysis = await generateAnalysis(sourceFiles, dependencyGraph);

    res.json({
      success: true,
      data: {
        owner,
        repo,
        fileCount: sourceFiles.length,
        overview: analysis.overview || 'Analysis unavailable',
        entryPoints: analysis.entryPoints || [],
        readingOrder: analysis.readingOrder || [],
        mermaidDiagram: analysis.mermaidDiagram || 'graph TD; Error[Analysis Failed]',
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