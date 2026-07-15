export interface AnalysisResult {
  overview: string;
  entryPoints: { file: string; why: string }[];
  readingOrder: { file: string; order: number; reason: string }[];
  mermaidDiagram: string;
}

export interface ApiResponse {
  success: boolean;
  data?: {
    owner: string;
    repo: string;
    fileCount: number;
    overview: string;
    entryPoints: { file: string; why: string }[];
    readingOrder: { file: string; order: number; reason: string }[];
    mermaidDiagram: string;
    generatedAt: string;
  };
  error?: string;
}