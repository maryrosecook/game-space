const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

export type OpenAiTranscriber = {
  transcribeAudio(base64Audio: string, mimeType: string): Promise<string>;
};

function normalizeMimeType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return 'audio/webm';
  }

  return trimmed;
}

function fileExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes('webm')) {
    return 'webm';
  }

  if (mimeType.includes('wav')) {
    return 'wav';
  }

  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'mp3';
  }

  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return 'm4a';
  }

  return 'webm';
}

export class OpenAiAudioTranscriber implements OpenAiTranscriber {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const envApiKey = process.env.OPENAI_API_KEY;
    const apiKey = options.apiKey ?? envApiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for audio transcription');
    }

    const configuredModel = options.model ?? process.env.OPENAI_TRANSCRIBE_MODEL;
    this.model =
      typeof configuredModel === 'string' && configuredModel.trim().length > 0
        ? configuredModel.trim()
        : DEFAULT_TRANSCRIPTION_MODEL;
    this.apiKey = apiKey.trim();
  }

  async transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
    const trimmedBase64 = base64Audio.trim();
    if (trimmedBase64.length === 0) {
      throw new Error('Audio payload was empty');
    }

    const normalizedMimeType = normalizeMimeType(mimeType);
    const audioBuffer = Buffer.from(trimmedBase64, 'base64');
    if (audioBuffer.length === 0) {
      throw new Error('Audio payload could not be decoded');
    }

    const formData = new FormData();
    const extension = fileExtensionForMimeType(normalizedMimeType);
    const blob = new Blob([audioBuffer], { type: normalizedMimeType });
    formData.append('file', blob, `recording.${extension}`);
    formData.append('model', this.model);

    const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      let errorMessage = `OpenAI transcription failed with status ${response.status}`;
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

    const payload = (await response.json()) as { text?: unknown };
    if (!payload || typeof payload.text !== 'string') {
      throw new Error('OpenAI transcription payload did not include text');
    }

    return payload.text.trim();
  }
}

