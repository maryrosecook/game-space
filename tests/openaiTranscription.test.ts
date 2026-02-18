import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAiAudioTranscriber } from '../src/services/openaiTranscription';

describe('OpenAiAudioTranscriber', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (typeof originalApiKey === 'string') {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    vi.unstubAllGlobals();
  });

  it('posts multipart data to OpenAI transcriptions endpoint', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ text: string }> }>>(async () => ({
      ok: true,
      async json() {
        return { text: 'hello world' };
      }
    }));

    vi.stubGlobal('fetch', fetchMock);

    const transcriber = new OpenAiAudioTranscriber({ apiKey: 'test-key' });
    const result = await transcriber.transcribeAudio(Buffer.from('voice').toString('base64'), 'audio/webm');

    expect(result).toBe('hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestUrl = firstCall?.[0];
    const requestInit = firstCall?.[1];
    expect(requestUrl).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-key'
      }
    });
  });

  it('throws when API key is missing', () => {
    expect(() => new OpenAiAudioTranscriber({ apiKey: '' })).toThrow(
      'OPENAI_API_KEY is required for audio transcription'
    );
  });
});
