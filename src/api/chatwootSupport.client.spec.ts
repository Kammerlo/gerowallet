// src/api/chatwootSupport.client.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Minimal AxiosError-shaped rejection (only the fields the client reads). */
function httpError(status: number) {
  return { isAxiosError: true, response: { status, data: {} }, message: `Request failed with status code ${status}` };
}

describe('chatwoot support client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPPORT_CHAT_URL', 'https://support.example.test');
    vi.resetModules();
  });

  it('builds the public inbox base URL from VITE_SUPPORT_CHAT_URL', async () => {
    const mod = await import('./chatwootSupport.client');
    expect(mod.supportChatAxiosInstance.defaults.baseURL).toBe(
      'https://support.example.test/public/api/v1/inboxes/gerowallet-extension',
    );
  });

  it('falls back to the production support origin when the env var is unset', async () => {
    vi.stubEnv('VITE_SUPPORT_CHAT_URL', '');
    vi.resetModules();
    const mod = await import('./chatwootSupport.client');
    expect(mod.supportChatAxiosInstance.defaults.baseURL).toBe(
      'https://support.gerowallet.io/public/api/v1/inboxes/gerowallet-extension',
    );
  });

  it('createContact() POSTs identifier + identifier_hash + name and returns sourceId/pubsubToken', async () => {
    const mod = await import('./chatwootSupport.client');
    const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({
      data: { source_id: 'src-1', pubsub_token: 'tok-1' },
    } as never);
    const res = await mod.chatwootSupportApi.createContact({
      identifier: 'v1:aa',
      identifierHash: 'hh',
      name: 'quiet-dew-4f2a',
    });
    expect(post).toHaveBeenCalledWith('/contacts', {
      identifier: 'v1:aa',
      identifier_hash: 'hh',
      name: 'quiet-dew-4f2a',
    });
    expect(res).toEqual({ sourceId: 'src-1', pubsubToken: 'tok-1' });
  });

  it('updateContact() PATCHes the SAME identifier + identifier_hash to the source_id', async () => {
    const mod = await import('./chatwootSupport.client');
    const patch = vi.spyOn(mod.supportChatAxiosInstance, 'patch').mockResolvedValue({ data: {} } as never);
    await mod.chatwootSupportApi.updateContact('src-1', {
      identifier: 'v1:aa',
      identifierHash: 'hh',
      name: 'quiet-dew-4f2a',
    });
    expect(patch).toHaveBeenCalledWith('/contacts/src-1', {
      identifier: 'v1:aa',
      identifier_hash: 'hh',
      name: 'quiet-dew-4f2a',
    });
  });

  it('ensureContact() always PATCHes after POST (the hmac_verified step)', async () => {
    const mod = await import('./chatwootSupport.client');
    const calls: string[] = [];
    vi.spyOn(mod.supportChatAxiosInstance, 'post').mockImplementation((async () => {
      calls.push('post');
      return { data: { source_id: 'src-1', pubsub_token: 'tok-1' } };
    }) as never);
    vi.spyOn(mod.supportChatAxiosInstance, 'patch').mockImplementation((async () => {
      calls.push('patch');
      return { data: {} };
    }) as never);

    const res = await mod.chatwootSupportApi.ensureContact({
      identifier: 'v1:aa',
      identifierHash: 'hh',
      name: 'n',
    });
    expect(calls).toEqual(['post', 'patch']);
    expect(res).toEqual({ sourceId: 'src-1', pubsubToken: 'tok-1' });
  });

  it('maps HTTP 500 on contact create to ChatAuthError (hmac_mandatory rejection)', async () => {
    const mod = await import('./chatwootSupport.client');
    vi.spyOn(mod.supportChatAxiosInstance, 'post').mockRejectedValue(httpError(500));
    await expect(
      mod.chatwootSupportApi.createContact({ identifier: 'v1:aa', identifierHash: 'bad', name: 'n' }),
    ).rejects.toBeInstanceOf(mod.ChatAuthError);
  });

  it('maps HTTP 500 on contact update to ChatAuthError', async () => {
    const mod = await import('./chatwootSupport.client');
    vi.spyOn(mod.supportChatAxiosInstance, 'patch').mockRejectedValue(httpError(500));
    await expect(
      mod.chatwootSupportApi.updateContact('src-1', { identifier: 'v1:aa', identifierHash: 'bad' }),
    ).rejects.toBeInstanceOf(mod.ChatAuthError);
  });

  it('does NOT map HTTP 500 on non-contact endpoints to ChatAuthError', async () => {
    const mod = await import('./chatwootSupport.client');
    vi.spyOn(mod.supportChatAxiosInstance, 'post').mockRejectedValue(httpError(500));
    const err = await mod.chatwootSupportApi
      .createConversation('src-1')
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(mod.ChatAuthError);
  });

  it('createConversation() POSTs to the contact conversations path and returns the id', async () => {
    const mod = await import('./chatwootSupport.client');
    const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({ data: { id: 42 } } as never);
    const id = await mod.chatwootSupportApi.createConversation('src-1');
    expect(post).toHaveBeenCalledWith('/contacts/src-1/conversations', {});
    expect(id).toBe(42);
  });

  it('sendMessage() POSTs { content } to the conversation messages path', async () => {
    const mod = await import('./chatwootSupport.client');
    const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({
      data: { id: 7, content: 'hi', message_type: 0, created_at: 1700000000 },
    } as never);
    const msg = await mod.chatwootSupportApi.sendMessage('src-1', 42, 'hi');
    expect(post).toHaveBeenCalledWith('/contacts/src-1/conversations/42/messages', { content: 'hi' });
    expect(msg).toEqual({ id: 7, role: 'user', text: 'hi', agentName: undefined, createdAt: 1700000000000 });
  });

  it('listMessages() GETs the messages path and normalizes, dropping activity + private notes', async () => {
    const mod = await import('./chatwootSupport.client');
    const get = vi.spyOn(mod.supportChatAxiosInstance, 'get').mockResolvedValue({
      data: [
        { id: 1, content: 'hello', message_type: 0, created_at: 1700000000 },
        { id: 2, content: 'hi there', message_type: 1, created_at: 1700000001, sender: { name: 'Ada' } },
        { id: 3, content: 'Conversation was resolved', message_type: 2, created_at: 1700000002 },
        { id: 4, content: 'internal note', message_type: 1, created_at: 1700000003, private: true },
      ],
    } as never);
    const msgs = await mod.chatwootSupportApi.listMessages('src-1', 42);
    expect(get).toHaveBeenCalledWith('/contacts/src-1/conversations/42/messages');
    expect(msgs).toEqual([
      { id: 1, role: 'user', text: 'hello', agentName: undefined, createdAt: 1700000000000 },
      { id: 2, role: 'agent', text: 'hi there', agentName: 'Ada', createdAt: 1700000001000 },
    ]);
  });

  it('listMessages() tolerates a { payload: [...] } envelope', async () => {
    const mod = await import('./chatwootSupport.client');
    vi.spyOn(mod.supportChatAxiosInstance, 'get').mockResolvedValue({
      data: { payload: [{ id: 9, content: 'x', message_type: 1, created_at: 1700000009 }] },
    } as never);
    const msgs = await mod.chatwootSupportApi.listMessages('src-1', 42);
    expect(msgs.map((m) => m.id)).toEqual([9]);
  });

  describe('sendMessage() — multipart with files', () => {
    it('builds FormData with content + attachments[] per file and does not force Content-Type', async () => {
      const mod = await import('./chatwootSupport.client');
      const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({
        data: { id: 8, content: 'see attached', message_type: 0, created_at: 1700000010 },
      } as never);
      const file1 = new File(['a'], 'a.png', { type: 'image/png' });
      const file2 = new File(['b'], 'b.pdf', { type: 'application/pdf' });

      const msg = await mod.chatwootSupportApi.sendMessage('src-1', 42, 'see attached', [file1, file2]);

      expect(post).toHaveBeenCalledTimes(1);
      const [url, body, config] = post.mock.calls[0];
      expect(url).toBe('/contacts/src-1/conversations/42/messages');
      expect(body).toBeInstanceOf(FormData);
      const formData = body as FormData;
      expect(formData.get('content')).toBe('see attached');
      const attachmentEntries = formData.getAll('attachments[]');
      expect(attachmentEntries).toHaveLength(2);
      expect((attachmentEntries[0] as File).name).toBe('a.png');
      expect((attachmentEntries[1] as File).name).toBe('b.pdf');
      expect((config as { headers?: Record<string, unknown> } | undefined)?.headers).toMatchObject({
        'Content-Type': undefined,
      });
      expect(msg?.id).toBe(8);
    });

    it('omits the content field from FormData when content is empty', async () => {
      const mod = await import('./chatwootSupport.client');
      const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({
        data: { id: 9, content: '', message_type: 0, created_at: 1700000011 },
      } as never);
      const file = new File(['a'], 'a.png', { type: 'image/png' });

      await mod.chatwootSupportApi.sendMessage('src-1', 42, '', [file]);

      const [, body] = post.mock.calls[0];
      const formData = body as FormData;
      expect(formData.has('content')).toBe(false);
      expect(formData.getAll('attachments[]')).toHaveLength(1);
    });

    it('keeps the JSON body path byte-identical when files is undefined or empty', async () => {
      const mod = await import('./chatwootSupport.client');
      const post = vi.spyOn(mod.supportChatAxiosInstance, 'post').mockResolvedValue({
        data: { id: 7, content: 'hi', message_type: 0, created_at: 1700000000 },
      } as never);

      await mod.chatwootSupportApi.sendMessage('src-1', 42, 'hi');
      expect(post).toHaveBeenNthCalledWith(1, '/contacts/src-1/conversations/42/messages', { content: 'hi' });

      await mod.chatwootSupportApi.sendMessage('src-1', 42, 'hi', []);
      expect(post).toHaveBeenNthCalledWith(2, '/contacts/src-1/conversations/42/messages', { content: 'hi' });
    });
  });

  describe('normalizeChatwootMessage() — attachments', () => {
    it('maps attachments snake_case to camelCase, skipping entries missing data_url or a numeric id, and defaulting fileType to "file"', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 10,
        content: 'see attached',
        message_type: 1,
        created_at: 1700000000,
        sender: { name: 'Ada' },
        attachments: [
          {
            id: 100,
            file_type: 'image',
            data_url: 'https://cdn.example.test/img.png',
            thumb_url: 'https://cdn.example.test/thumb.png',
            file_size: 2048,
            extension: 'png',
          },
          { id: 101, file_type: 'file', data_url: '' }, // missing data_url -> skipped
          { id: 102, file_type: 'file' }, // missing data_url -> skipped
          { id: 103, data_url: 'https://cdn.example.test/no-filetype.bin' }, // no file_type -> defaults to 'file'
          { file_type: 'file', data_url: 'https://cdn.example.test/no-id.bin' }, // missing id -> skipped
          { id: 'not-a-number', file_type: 'file', data_url: 'https://cdn.example.test/bad-id.bin' }, // non-numeric id -> skipped
        ],
      } as never);
      expect(msg?.attachments).toEqual([
        {
          id: 100,
          fileType: 'image',
          dataUrl: 'https://cdn.example.test/img.png',
          thumbUrl: 'https://cdn.example.test/thumb.png',
          fileSize: 2048,
          extension: 'png',
          fileName: 'img.png',
        },
        {
          id: 103,
          fileType: 'file',
          dataUrl: 'https://cdn.example.test/no-filetype.bin',
          fileName: 'no-filetype.bin',
        },
      ]);
    });

    it('does NOT drop a message with empty content when it has at least one attachment', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 11,
        content: '',
        message_type: 0,
        created_at: 1700000001,
        attachments: [{ id: 200, file_type: 'image', data_url: 'https://cdn.example.test/a.png' }],
      });
      expect(msg).not.toBeNull();
      expect(msg?.text).toBe('');
      expect(msg?.attachments).toEqual([
        { id: 200, fileType: 'image', dataUrl: 'https://cdn.example.test/a.png', fileName: 'a.png' },
      ]);
    });

    it('still drops a message with empty content and no attachments', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 12,
        content: '',
        message_type: 0,
        created_at: 1700000002,
      });
      expect(msg).toBeNull();
    });

    it('still drops a message with empty content when every attachment lacks data_url', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 13,
        content: '',
        message_type: 0,
        created_at: 1700000003,
        attachments: [{ id: 300, file_type: 'file' }],
      });
      expect(msg).toBeNull();
    });

    it('omits the attachments field entirely when the payload has none', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 14,
        content: 'no files here',
        message_type: 0,
        created_at: 1700000004,
      });
      expect(msg).not.toBeNull();
      expect('attachments' in (msg as object)).toBe(false);
    });
  });

  describe('normalizeChatwootMessage() — attachment fileName', () => {
    it('uses file_name verbatim when present', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 20,
        content: 'x',
        message_type: 0,
        created_at: 1700000020,
        attachments: [
          { id: 1, file_type: 'file', data_url: 'https://cdn.example.test/abc123.pdf', file_name: 'Q3 report.pdf' },
        ],
      } as never);
      expect(msg?.attachments?.[0].fileName).toBe('Q3 report.pdf');
    });

    it('falls back to filename (no underscore) when file_name is absent', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 21,
        content: 'x',
        message_type: 0,
        created_at: 1700000021,
        attachments: [{ id: 2, file_type: 'file', data_url: 'https://cdn.example.test/abc.pdf', filename: 'invoice.pdf' }],
      } as never);
      expect(msg?.attachments?.[0].fileName).toBe('invoice.pdf');
    });

    it('extracts + decodes the data_url basename, handling an encoded space, when no name field is present', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 22,
        content: 'x',
        message_type: 0,
        created_at: 1700000022,
        attachments: [{ id: 3, file_type: 'image', data_url: 'https://cdn.example.test/path/My%20Screenshot.png' }],
      });
      expect(msg?.attachments?.[0].fileName).toBe('My Screenshot.png');
    });

    it('strips the query string before extracting the basename', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 23,
        content: 'x',
        message_type: 0,
        created_at: 1700000023,
        attachments: [
          {
            id: 4,
            file_type: 'file',
            data_url: 'https://storage.googleapis.com/bucket/report.pdf?X-Goog-Signature=abc123&Expires=999',
          },
        ],
      });
      expect(msg?.attachments?.[0].fileName).toBe('report.pdf');
    });

    it('leaves fileName undefined when neither a name field nor a usable basename exists', async () => {
      const mod = await import('./chatwootSupport.client');
      const msg = mod.normalizeChatwootMessage({
        id: 24,
        content: 'x',
        message_type: 0,
        created_at: 1700000024,
        attachments: [
          // basename over the 120-char sanity cap -> treated as unusable noise, not a real name
          { id: 5, file_type: 'file', data_url: `https://cdn.example.test/${'a'.repeat(130)}` },
        ],
      });
      expect(msg?.attachments?.[0].fileName).toBeUndefined();
    });
  });
});
