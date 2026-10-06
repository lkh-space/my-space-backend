export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  generate(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): Promise<LlmResponse>;
  stream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): AsyncGenerator<string, void, unknown>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
