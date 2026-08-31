import { describe, expect, it } from 'vitest';
import {
  createMockDirectoryProvider,
  invitationTestHooks,
  mockInvitationId,
} from '../../server/providers/mock/directory';
import type { RequestAuth } from '../../server/providers/types';

const auth: RequestAuth = {
  token: 'mock:katherine',
  user: { id: 'mock-katherine', username: 'katherine', displayName: 'Katherine Johnson' },
  isAdmin: true,
};

const invitation = (email: string) => ({
  email,
  redirectUrl: 'http://localhost:4924/',
  message: 'Katherine Johnson has invited you to collaborate in Marky Mark.',
});

describe('PRD 017 §Invitations Req 33 mock directory invitations', () => {
  it('U988: an invite creates an in-memory pending guest that search, getUser and listUsers all answer', async () => {
    const directory = createMockDirectoryProvider();
    const id = mockInvitationId('friend@example.com');
    const outcome = await directory.invite(invitation('friend@example.com'), auth);
    expect(outcome).toMatchObject({
      ok: true,
      user: { id, displayName: 'friend@example.com', isGuest: true, pending: true },
    });
    expect(await directory.getUser(id, auth)).toMatchObject({ isGuest: true, pending: true });
    expect((await directory.listUsers(auth)).some((u) => u.id === id)).toBe(true);
    expect(await directory.search('friend', auth)).toEqual([expect.objectContaining({ id })]);
  });

  it("U989: inviting a known address answers Graph's refusal shape — code and message, no duplicate user", async () => {
    const directory = createMockDirectoryProvider();
    await directory.invite(invitation('friend@example.com'), auth);
    const again = await directory.invite(invitation('Friend@Example.com'), auth);
    expect(again).toEqual({
      ok: false,
      code: 'invitedUserAlreadyExists',
      message: expect.stringContaining('already exists'),
    });
    const matches = (await directory.listUsers(auth)).filter(
      (u) => u.username.toLowerCase() === 'friend@example.com',
    );
    expect(matches).toHaveLength(1);
  });

  it('U990: the test hooks mark an invitation accepted (Pending clears) and withdraw it (gone entirely)', async () => {
    const directory = createMockDirectoryProvider();
    const hooks = invitationTestHooks(directory);
    expect(hooks).not.toBeNull();
    await directory.invite(invitation('friend@example.com'), auth);
    const id = mockInvitationId('friend@example.com');
    expect(hooks!.acceptInvitation(id)).toBe(true);
    expect(await directory.getUser(id, auth)).toMatchObject({ isGuest: true, pending: false });
    expect(hooks!.withdrawInvitation(id)).toBe(true);
    expect(await directory.getUser(id, auth)).toBeNull();
    expect(hooks!.acceptInvitation('mock-invite-nobody')).toBe(false);
    expect(hooks!.withdrawInvitation('mock-invite-nobody')).toBe(false);
  });
});
