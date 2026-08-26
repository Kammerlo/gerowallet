// The decision table behind the rationale dialog, tested without a DOM.
// Everything here is a refusal rule: what has to be true before a document a
// stranger hosts is allowed to become text on a wallet screen.
import { describe, it, expect, vi } from 'vitest';
import { blake2bHex } from 'blakejs';

import { extractRationaleSections, loadRationale, MAX_RATIONALE_BYTES } from './rationaleDoc';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function hashOf(bytes: Uint8Array): string {
  return blake2bHex(bytes, undefined, 32);
}

function response(bytes: Uint8Array, options: { ok?: boolean; contentLength?: string } = {}) {
  return {
    ok: options.ok ?? true,
    headers: { get: (name: string) => (name === 'content-length' ? options.contentLength ?? null : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function fetching(bytes: Uint8Array, options?: { ok?: boolean; contentLength?: string }) {
  return vi.fn().mockResolvedValue(response(bytes, options)) as unknown as typeof fetch;
}

describe('loadRationale', () => {
  it('verifies against the RAW bytes, not a re-serialized form', async () => {
    // Two-space indent here, none in the hash target: a document that was
    // re-serialized before hashing would pass this and must not.
    const raw = '{\n  "body": {\n    "comment": "Because."\n  }\n}';
    const bytes = bytesOf(raw);

    const ok = await loadRationale({ url: 'https://a.test/r.json', hash: hashOf(bytes), fetchImpl: fetching(bytes) });
    expect(ok.status).toBe('verified');

    const reserialized = hashOf(bytesOf(JSON.stringify(JSON.parse(raw))));
    const bad = await loadRationale({ url: 'https://a.test/r.json', hash: reserialized, fetchImpl: fetching(bytes) });
    expect(bad).toEqual({ status: 'failed', reason: 'mismatch' });
  });

  it('treats a missing or malformed hash as unverifiable and never asks the host', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const hash of [null, undefined, '', 'not-a-hash', 'ab'.repeat(10)]) {
      const result = await loadRationale({ url: 'https://a.test/r.json', hash, fetchImpl });
      expect(result).toEqual({ status: 'failed', reason: 'unverifiable' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts an uppercase hash, which is the same hash', async () => {
    const bytes = bytesOf('{"body":{"comment":"hi"}}');
    const result = await loadRationale({
      url: 'https://a.test/r.json',
      hash: hashOf(bytes).toUpperCase(),
      fetchImpl: fetching(bytes),
    });
    expect(result.status).toBe('verified');
  });

  it('stops on the declared length before buffering anything', async () => {
    const arrayBuffer = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => String(MAX_RATIONALE_BYTES + 1) },
      arrayBuffer,
    }) as unknown as typeof fetch;

    const result = await loadRationale({ url: 'https://a.test/r.json', hash: 'a'.repeat(64), fetchImpl });
    expect(result).toEqual({ status: 'failed', reason: 'oversize' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops on the arrived length when the header understated it', async () => {
    const bytes = bytesOf('x'.repeat(200));
    const result = await loadRationale({
      url: 'https://a.test/r.json',
      hash: hashOf(bytes),
      fetchImpl: fetching(bytes, { contentLength: '4' }),
      maxBytes: 100,
    });
    // The bytes hash correctly. They are still refused: the cap is a cap.
    expect(result).toEqual({ status: 'failed', reason: 'oversize' });
  });

  it('reports a refusal, an outage and an abort identically', async () => {
    const refused = vi.fn().mockResolvedValue(response(bytesOf('x'), { ok: false })) as unknown as typeof fetch;
    const offline = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;

    expect(await loadRationale({ url: 'https://a.test/r.json', hash: 'a'.repeat(64), fetchImpl: refused })).toEqual({
      status: 'failed',
      reason: 'network',
    });
    expect(await loadRationale({ url: 'https://a.test/r.json', hash: 'a'.repeat(64), fetchImpl: offline })).toEqual({
      status: 'failed',
      reason: 'network',
    });
  });

  it('aborts once the timeout passes rather than waiting on a dead host', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const result = await loadRationale({
      url: 'https://a.test/r.json',
      hash: 'a'.repeat(64),
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result).toEqual({ status: 'failed', reason: 'network' });
  });

  it('refuses a URL it cannot safely load at all', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '']) {
      expect(await loadRationale({ url, hash: 'a'.repeat(64), fetchImpl })).toEqual({
        status: 'failed',
        reason: 'network',
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls a verified but wordless document empty rather than showing a blank card', async () => {
    const bytes = bytesOf('{"body":{"internalVote":{"yes":3}}}');
    const result = await loadRationale({
      url: 'https://a.test/r.json',
      hash: hashOf(bytes),
      fetchImpl: fetching(bytes),
    });
    expect(result).toEqual({ status: 'failed', reason: 'empty' });
  });
});

describe('extractRationaleSections', () => {
  it('reads the CIP-136 fields in the order they are meant to be read', () => {
    const sections = extractRationaleSections(
      JSON.stringify({
        body: {
          conclusion: 'So we voted no.',
          summary: 'Short version.',
          rationaleStatement: 'The long version.',
        },
      }),
    );
    expect(sections.map(section => section.text)).toEqual([
      'Short version.',
      'The long version.',
      'So we voted no.',
    ]);
    expect(sections[0].labelKey).toBe('dashboard.summary');
  });

  it('unwraps a JSON-LD {"@value"} the same way the DRep surfaces do', () => {
    const sections = extractRationaleSections(JSON.stringify({ body: { comment: { '@value': 'Because.' } } }));
    expect(sections).toEqual([{ labelKey: null, text: 'Because.' }]);
  });

  it('keeps a verified document whose shape is not CIP-136 at all', () => {
    // It hashed correctly, so it IS what the voter published. Hiding their own
    // words because the JSON surprised us would be the worse failure, and
    // renderMarkdown escapes every byte of it downstream.
    const sections = extractRationaleSections('We voted no, and here is why.');
    expect(sections).toEqual([{ labelKey: null, text: 'We voted no, and here is why.' }]);
  });

  it('tolerates a body-less document by reading the top level', () => {
    expect(extractRationaleSections(JSON.stringify({ comment: 'Flat.' }))).toEqual([
      { labelKey: null, text: 'Flat.' },
    ]);
  });

  it('returns nothing for a document with no prose in it', () => {
    expect(extractRationaleSections('{}')).toEqual([]);
    expect(extractRationaleSections('   ')).toEqual([]);
  });
});
