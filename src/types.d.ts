declare module 'madge';

interface SourceFile {
  name: string;
  content: string;
  path: string;
}

interface AnalysisResult {
  overview: string;
  entryPoints: { file: string; why: string }[];
  readingOrder: { file: string; order: number; reason: string }[];
  mermaidDiagram: string;
}

interface GitHubApiItem {
  type: string;
  name: string;
  path?: string;
  content?: string;
}

export { SourceFile, AnalysisResult, GitHubApiItem };