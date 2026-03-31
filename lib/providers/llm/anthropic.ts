import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from './types';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');
  }
}
