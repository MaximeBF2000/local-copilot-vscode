/** Chat prompts for Cmd+J (inline) and Cmd+Shift+J (file) edits. */

import { ChatMessage } from '../ollama/ollamaClient';

export interface InlineEditPromptInput {
  instruction: string;
  filePath: string;
  languageId: string;
  codeBefore: string;
  targetCode: string;
  codeAfter: string;
}

const INLINE_EDIT_SYSTEM = `You are an expert programmer editing code inside an editor.
You receive a file excerpt where the code to change is between <target> and </target>, and an instruction.
Rewrite ONLY the target code so that it follows the instruction.
Rules:
- Reply with the complete replacement for the target code in a single markdown code block, and nothing else.
- Do not include code that is outside the target.
- Keep the original indentation, style and conventions of the file.
- Preserve behaviour that the instruction does not ask to change.`;

const INSERT_SYSTEM = `You are an expert programmer writing code inside an editor.
You receive a file excerpt with an <insert-here/> marker, and an instruction.
Write the code to insert at the marker so that it follows the instruction.
Rules:
- Reply with only the code to insert, in a single markdown code block, and nothing else.
- Do not repeat surrounding code.
- Match the indentation, style and conventions of the file.`;

export function buildInlineEditMessages(input: InlineEditPromptInput): ChatMessage[] {
  const isInsertion = input.targetCode.trim() === '';
  const excerpt = isInsertion
    ? `${input.codeBefore}<insert-here/>\n${input.codeAfter}`
    : `${input.codeBefore}<target>\n${input.targetCode}\n</target>\n${input.codeAfter}`;
  return [
    { role: 'system', content: isInsertion ? INSERT_SYSTEM : INLINE_EDIT_SYSTEM },
    {
      role: 'user',
      content: `File: ${input.filePath}\n\n\`\`\`${input.languageId}\n${excerpt}\n\`\`\`\n\nInstruction: ${input.instruction}`,
    },
  ];
}

export interface RelatedFile {
  path: string;
  content: string;
}

export interface FileEditPromptInput {
  instruction: string;
  filePath: string;
  languageId: string;
  fileContent: string;
  relatedFiles: RelatedFile[];
}

const FILE_EDIT_SYSTEM = `You are an expert programmer editing a file.
Describe every change as SEARCH/REPLACE blocks using exactly this format:

<<<<<<< SEARCH
exact lines copied from the current file
=======
new lines that replace them
>>>>>>> REPLACE

Rules:
- The SEARCH part must match the current file exactly, including indentation and comments.
- Include just enough lines in SEARCH to be unique in the file; keep blocks small.
- Use one block per separate change, in the order they appear in the file.
- To delete code, leave the REPLACE part empty. To add code, include a nearby line in SEARCH and repeat it in REPLACE with the new code.
- Only edit the current file. Other files are read-only context.
- Reply with the blocks only, without explanations.`;

const FULL_FILE_SYSTEM = `You are an expert programmer editing a file.
Reply with the COMPLETE new content of the file after applying the instruction, in a single markdown code block, and nothing else.
Keep everything the instruction does not ask to change exactly as it is.`;

function describeFiles(input: FileEditPromptInput): string {
  const related = input.relatedFiles
    .map((file) => `Read-only context file: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
    .join('\n\n');
  const current = `Current file: ${input.filePath}\n\`\`\`${input.languageId}\n${input.fileContent}\n\`\`\``;
  return related ? `${related}\n\n${current}` : current;
}

export function buildFileEditMessages(input: FileEditPromptInput): ChatMessage[] {
  return [
    { role: 'system', content: FILE_EDIT_SYSTEM },
    { role: 'user', content: `${describeFiles(input)}\n\nInstruction: ${input.instruction}` },
  ];
}

/** Fallback when SEARCH/REPLACE blocks could not be applied: ask for the whole file. */
export function buildFullFileMessages(input: FileEditPromptInput): ChatMessage[] {
  return [
    { role: 'system', content: FULL_FILE_SYSTEM },
    { role: 'user', content: `${describeFiles(input)}\n\nInstruction: ${input.instruction}` },
  ];
}
