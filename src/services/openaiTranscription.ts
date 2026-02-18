const OPENAI_REALTIME_TRANSCRIPTION_SESSIONS_URL = 'https://api.openai.com/v1/realtime/transcription_sessions';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';

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
  const clientSecretValue = payload.client_secret;
  if (!isJsonObject(clientSecretValue)) {
    return null;
  }

  const value = readString(clientSecretValue.value);
  const expiresAt = readFiniteNumber(clientSecretValue.expires_at);
  if (!value || expiresAt === null) {
    return null;
  }

  return { value, expiresAt };
}

function readSessionModel(payload: JsonObject): string | null {
  const transcriptionValue = payload.input_audio_transcription;
  if (!isJsonObject(transcriptionValue)) {
    return null;
  }

  return readString(transcriptionValue.model);
}

export class OpenAiRealtimeTranscriptionSessionFactory implements OpenAiRealtimeTranscriptionSessionCreator {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const envApiKey = process.env.OPENAI_API_KEY;
    const apiKey = options.apiKey ?? envApiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for realtime transcription');
    }

    const configuredModel = options.model ?? process.env.OPENAI_TRANSCRIBE_MODEL;
    this.model =
      typeof configuredModel === 'string' && configuredModel.trim().length > 0
        ? configuredModel.trim()
        : DEFAULT_TRANSCRIPTION_MODEL;
    this.apiKey = apiKey.trim();
  }

  async createSession(): Promise<RealtimeTranscriptionSession> {
    const response = await fetch(OPENAI_REALTIME_TRANSCRIPTION_SESSIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input_audio_transcription: {
          model: this.model
        }
      })
    });

    if (!response.ok) {
      let errorMessage = `OpenAI realtime transcription session failed with status ${response.status}`;
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
      throw new Error('OpenAI realtime transcription payload missing client secret');
    }

    const model = readSessionModel(payload) ?? this.model;
    return {
      clientSecret: clientSecret.value,
      expiresAt: clientSecret.expiresAt,
      model
    };
  }
}
