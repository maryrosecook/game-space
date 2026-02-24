import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_INPUT_TRANSCRIPTION_MODEL,
  DEFAULT_REALTIME_MODEL,
  OpenAiRealtimeTranscriptionSessionFactory
} from '../src/services/openaiTranscription';

describe('OpenAiRealtimeTranscriptionSessionFactory', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalTranscriptionModel = process.env.OPENAI_TRANSCRIBE_MODEL;

  afterEach(() => {
    if (typeof originalApiKey === 'string') {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    if (typeof originalTranscriptionModel === 'string') {
      process.env.OPENAI_TRANSCRIBE_MODEL = originalTranscriptionModel;
    } else {
      delete process.env.OPENAI_TRANSCRIBE_MODEL;
    }

    vi.unstubAllGlobals();
  });

  it('creates a realtime client secret with the latest realtime model', async () => {
    const fetchMock = vi.fn<
      (
        url: string,
        init?: RequestInit
      ) => Promise<{ ok: boolean; json: () => Promise<{ value: string; expires_at: number }> }>
    >(async () => ({
      ok: true,
      async json() {
        return {
          value: 'ephemeral-secret',
          expires_at: 1_737_000_000
        };
      }
    }));

    vi.stubGlobal('fetch', fetchMock);

    const sessionFactory = new OpenAiRealtimeTranscriptionSessionFactory({ apiKey: 'test-key' });
    const session = await sessionFactory.createSession();

    expect(session).toEqual({
      clientSecret: 'ephemeral-secret',
      expiresAt: 1_737_000_000,
      model: DEFAULT_REALTIME_MODEL
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json'
      }
    });
    expect(requestInit?.body).toBe(
      JSON.stringify({
        session: {
          type: 'realtime',
          model: DEFAULT_REALTIME_MODEL,
          audio: {
            input: {
              transcription: {
                model: DEFAULT_INPUT_TRANSCRIPTION_MODEL
              }
            }
          }
        }
      })
    );
  });

  it('ignores OPENAI_TRANSCRIBE_MODEL and always uses the latest realtime model', async () => {
    process.env.OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
      async () => ({
        ok: true,
        async json() {
          return {
            session: {
              model: 'gpt-realtime-1.0'
            },
            value: 'ephemeral-secret',
            expires_at: 1_737_000_000
          };
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const sessionFactory = new OpenAiRealtimeTranscriptionSessionFactory({ apiKey: 'test-key' });
    await sessionFactory.createSession();

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.body).toBe(
      JSON.stringify({
        session: {
          type: 'realtime',
          model: DEFAULT_REALTIME_MODEL,
          audio: {
            input: {
              transcription: {
                model: DEFAULT_INPUT_TRANSCRIPTION_MODEL
              }
            }
          }
        }
      })
    );
  });

  it('throws when API key is missing', () => {
    expect(() => new OpenAiRealtimeTranscriptionSessionFactory({ apiKey: '' })).toThrow(
      'OPENAI_API_KEY is required for realtime transcription'
    );
  });

  it('throws when payload does not include a client secret value', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
      async () => ({
        ok: true,
        async json() {
          return {};
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const sessionFactory = new OpenAiRealtimeTranscriptionSessionFactory({ apiKey: 'test-key' });
    await expect(sessionFactory.createSession()).rejects.toThrow(
      'OpenAI realtime client secret payload missing value'
    );
  });
});
