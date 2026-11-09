import * as path from 'path';
import * as vscode from 'vscode';
import { RelatedFile } from './editPrompts';
import { LocalImport, candidatePaths, findLocalImports } from './importParsing';

const MAX_LINES_PER_FILE = 400;

export interface ImportedFile {
  uri: vscode.Uri;
  /** Workspace-relative path. */
  path: string;
  symbols: string[];
}

/** Resolves the current file's relative imports to files that exist in the workspace. */
export async function findImportedFiles(document: vscode.TextDocument): Promise<ImportedFile[]> {
  const imports = findLocalImports(document.getText(), document.languageId);
  const directory = path.dirname(document.uri.fsPath);
  const resolved = await Promise.all(imports.map((imp) => resolveImport(directory, imp, document.languageId)));
  const unique = new Map<string, ImportedFile>();
  for (const file of resolved) {
    if (file && !unique.has(file.path)) unique.set(file.path, file);
  }
  return [...unique.values()];
}

async function resolveImport(directory: string, imp: LocalImport, languageId: string): Promise<ImportedFile | undefined> {
  for (const candidate of candidatePaths(imp.specifier, languageId)) {
    const uri = vscode.Uri.file(path.resolve(directory, candidate));
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) {
        return { uri, path: vscode.workspace.asRelativePath(uri, false), symbols: imp.symbols };
      }
    } catch {
      // Not this candidate; try the next one.
    }
  }
  return undefined;
}

/** Reads imported files, truncated so the prompt stays a reasonable size. */
export async function readRelatedFiles(files: ImportedFile[]): Promise<RelatedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const lines = new TextDecoder().decode(bytes).split('\n');
      const content =
        lines.length > MAX_LINES_PER_FILE
          ? `${lines.slice(0, MAX_LINES_PER_FILE).join('\n')}\n… (${lines.length - MAX_LINES_PER_FILE} more lines)`
          : lines.join('\n');
      return { path: file.path, content };
    }),
  );
}
