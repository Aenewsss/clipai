import { LLMProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { DeepSeekProvider } from './deepseek';

export function createLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER || 'anthropic';

  switch (provider) {
    case 'deepseek':
      return new DeepSeekProvider();
    case 'anthropic':
      return new AnthropicProvider();
    default:
      throw new Error(`LLM provider desconhecido: "${provider}". Use "anthropic" ou "deepseek".`);
  }
}

export type { LLMProvider };
