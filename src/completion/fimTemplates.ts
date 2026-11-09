/**
 * Fill-in-the-middle (FIM) prompt formats.
 * Code models are trained with special tokens marking the code before the cursor,
 * the code after it, and where to generate the missing middle part.
 */

export type PromptFormat = 'qwen' | 'deepseek' | 'codellama' | 'starcoder' | 'codegemma' | 'chat';

export interface FimInput {
  prefix: string;
  suffix: string;
  /** Workspace-relative file path, gives the model a hint about the language. */
  filePath: string;
  /** Workspace/project name. */
  projectName: string;
}

export interface FimTemplate {
  build(input: FimInput): string;
  /** Tokens that must end the generation. */
  stopTokens: string[];
}

const QWEN_SPECIAL_TOKENS = [
  '<|endoftext|>',
  '<|fim_prefix|>',
  '<|fim_suffix|>',
  '<|fim_middle|>',
  '<|fim_pad|>',
  '<|file_sep|>',
  '<|repo_name|>',
  '<|im_start|>',
  '<|im_end|>',
];

const TEMPLATES: Record<Exclude<PromptFormat, 'chat'>, FimTemplate> = {
  qwen: {
    build: ({ prefix, suffix, filePath, projectName }) =>
      `<|repo_name|>${projectName}\n<|file_sep|>${filePath}\n` +
      `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
    stopTokens: QWEN_SPECIAL_TOKENS,
  },
  deepseek: {
    build: ({ prefix, suffix }) => `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`,
    stopTokens: ['<｜end▁of▁sentence｜>', '<｜fim▁begin｜>', '<｜fim▁hole｜>', '<｜fim▁end｜>', '<|EOT|>'],
  },
  codellama: {
    build: ({ prefix, suffix }) => `<PRE> ${prefix} <SUF>${suffix} <MID>`,
    stopTokens: ['<EOT>', '<PRE>', '<SUF>', '<MID>'],
  },
  starcoder: {
    build: ({ prefix, suffix }) => `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`,
    stopTokens: ['<|endoftext|>', '<fim_prefix>', '<fim_suffix>', '<fim_middle>', '<file_sep>'],
  },
  codegemma: {
    build: ({ prefix, suffix }) => `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
    stopTokens: ['<|file_separator|>', '<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>', '<end_of_turn>', '<eos>'],
  },
};

/** Chooses a prompt format from the model name when the setting is 'auto'. */
export function resolvePromptFormat(setting: PromptFormat | 'auto', modelName: string): PromptFormat {
  if (setting !== 'auto') {
    return setting;
  }
  const name = modelName.toLowerCase();
  if (name.includes('qwen')) return 'qwen';
  if (name.includes('deepseek-coder') || name.includes('deepseek-v2') || name.includes('deepseek-v3')) return 'deepseek';
  if (name.includes('codellama')) return 'codellama';
  if (name.includes('starcoder')) return 'starcoder';
  if (name.includes('codegemma')) return 'codegemma';
  return 'chat';
}

export function getFimTemplate(format: Exclude<PromptFormat, 'chat'>): FimTemplate {
  return TEMPLATES[format];
}
