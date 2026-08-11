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
});
