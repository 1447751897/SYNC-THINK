import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_AVATAR, defaultAgentAvatar, resolveAgentAvatar } from './agent-avatar.js';
import { CHAT_AGENT_TOOL_SCHEMAS } from './chat-tools.js';

describe('classic agent creation defaults', () => {
  it.each([undefined, '', '  '])('uses a classic built-in seed for %s', avatar => {
    expect(defaultAgentAvatar(avatar)).toBe(DEFAULT_AGENT_AVATAR);
    expect(DEFAULT_AGENT_AVATAR).toMatch(/^bot:v1:/);
  });
  it.each(['bot:v1:star:cyan', 'aw:v1:heart:#aabbcc:happy', 'data:image/png;base64,AAAA', '✨'])('retains an explicit override: %s', avatar => {
    expect(defaultAgentAvatar(avatar)).toBe(avatar);
  });
  it('instructs the model to omit the avatar by default rather than invent emoji or generate an image', () => {
    const tool = CHAT_AGENT_TOOL_SCHEMAS.find(tool => tool.name === 'create_agent')!;
    expect(tool.description).toContain('By default omit avatar');
    expect(tool.description).toContain('unless the user explicitly requested a custom avatar');
    const schema = tool.inputSchema as { properties: { avatar: { description: string } }; required: string[] };
    expect(schema.required).not.toContain('avatar');
    expect(schema.properties.avatar.description).toContain('Omit by default');
  });
});

describe('agent avatar tool validation', () => {
  it.each(['gen:v1:blob:green', 'bot:v1:clover:preset', 'aw:v1:heart:#aabbcc:happy', 'aw:v2:bunny:#85b2c5:happy:classic:beret:glasses:bow', '✨', '', 'data:image/png;base64,AAAA'])('accepts explicit avatar %s', avatar => {
    expect(resolveAgentAvatar(avatar)).toEqual({ ok: true, avatar });
  });
  it('converts a legacy plush seed to classic while retaining all appearance slots', () => {
    expect(resolveAgentAvatar('aw:v2:bunny:#85b2c5:happy:plush:beret:glasses:bow')).toEqual({ ok: true, avatar: 'aw:v2:bunny:#85b2c5:happy:classic:beret:glasses:bow' });
  });
  it.each([42, 'https://example.com/avatar.png', 'bad\ntext', 'long decorative text', 'bot:v1:star:cyan:extra', 'aw:v2:bunny:#85b2c5:happy:classic:unknown:none:none', 'aw:v1:heart:javascript:happy', 'aw:v1:heart:#aabbcc:happy:extra', 'data:image/png;base64,' + 'A'.repeat(200_000)])('rejects malformed avatars without fetching anything', avatar => {
    expect(resolveAgentAvatar(avatar).ok).toBe(false);
  });
  it.each([undefined, null])('lets %s use the default appearance', avatar => {
    expect(resolveAgentAvatar(avatar)).toEqual({ ok: true });
  });
});
