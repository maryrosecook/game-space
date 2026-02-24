const OPENAI_REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-1.5';
export const DEFAULT_INPUT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

type JsonObject = Record<string, unknown>;

export type RealtimeTranscriptionSession = {
  clientSecret: string;
  expiresAt: number;
  model: string;
};

export type OpenAiRealtimeTranscriptionSessionCreator = {
  createSession(): Promise<RealtimeTranscriptionSession>;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readClientSecret(payload: JsonObject): { value: string; expiresAt: number } | null {
  const value = readString(payload.value);
  const expiresAt = readFiniteNumber(payload.expires_at);
  if (!value || expiresAt === null) {
    return null;
  }

  return { value, expiresAt };
}

export class OpenAiRealtimeTranscriptionSessionFactory implements OpenAiRealtimeTranscriptionSessionCreator {
  private readonly apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    const envApiKey = process.env.OPENAI_API_KEY;
    const apiKey = options.apiKey ?? envApiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for realtime transcription');
    }

    this.apiKey = apiKey.trim();
  }

  async createSession(): Promise<RealtimeTranscriptionSession> {
    return this.createSessionWithModel(DEFAULT_REALTIME_MODEL);
  }

  private async createSessionWithModel(model: string): Promise<RealtimeTranscriptionSession> {
    const response = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          audio: {
            input: {
              transcription: {
                model: DEFAULT_INPUT_TRANSCRIPTION_MODEL
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      let errorMessage = `OpenAI realtime client secret request failed with status ${response.status}`;
      try {
        const responseText = await response.text();
        if (responseText.length > 0) {
          errorMessage = `${errorMessage}: ${responseText}`;
        }
      } catch {
        // Keep default error when response body cannot be read.
      }

      throw new Error(errorMessage);
    }

    const payload = (await response.json()) as unknown;
    if (!isJsonObject(payload)) {
      throw new Error('OpenAI realtime transcription payload was invalid');
    }

    const clientSecret = readClientSecret(payload);
    if (!clientSecret) {
      throw new Error('OpenAI realtime client secret payload missing value');
    }

    return {
      clientSecret: clientSecret.value,
      expiresAt: clientSecret.expiresAt,
      model
    };
  }
}
