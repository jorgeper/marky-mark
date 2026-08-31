import { describe, expect, it } from 'vitest';
import {
  deploymentOrigin,
  INVITATION_NOTE_MAX,
  invitationMessage,
  isInvitableEmail,
  offersInviteRow,
  parseInvitationRequest,
} from '../../src/lib/invitations';

describe('PRD 017 §Invitations Req 29 body parser', () => {
  it('U981: a valid body parses — bare email, with a note, and with a workspace grant against the known-role list', () => {
    expect(parseInvitationRequest({ email: 'friend@example.com' })).toEqual({
      ok: true,
      invitation: { email: 'friend@example.com' },
    });
    expect(
      parseInvitationRequest({ email: ' friend@example.com ', note: 'See the Q3 notes.' }),
    ).toEqual({
      ok: true,
      invitation: { email: 'friend@example.com', note: 'See the Q3 notes.' },
    });
    // The role list defaults to the built-ins; the server passes the target
    // workspace's grantable set, so a custom role parses when it is known.
    expect(
      parseInvitationRequest(
        { email: 'friend@example.com', workspace: { id: 'ws1', role: 'Scribe' } },
        ['Owner', 'Viewer', 'Scribe'],
      ),
    ).toEqual({
      ok: true,
      invitation: { email: 'friend@example.com', workspace: { id: 'ws1', role: 'Scribe' } },
    });
    expect(
      parseInvitationRequest({ email: 'friend@example.com', workspace: { id: 'ws1', role: 'Commenter' } }),
    ).toMatchObject({ ok: true });
  });

  it('U982: a malformed email is refused by name — and non-object bodies refuse too', () => {
    for (const email of ['', 'nobody', 'nobody@', '@example.com', 'no body@example.com', 'nobody@example']) {
      const parsed = parseInvitationRequest({ email });
      expect(parsed.ok, email).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain('email');
    }
    expect(parseInvitationRequest(null)).toMatchObject({ ok: false });
    expect(parseInvitationRequest([])).toMatchObject({ ok: false });
    expect(parseInvitationRequest('x@example.com')).toMatchObject({ ok: false });
  });

  it('U983: an unknown role is a named refusal — the built-ins are the default list', () => {
    const parsed = parseInvitationRequest({
      email: 'friend@example.com',
      workspace: { id: 'ws1', role: 'Scribe' },
    });
    expect(parsed).toEqual({ ok: false, error: "unknown role 'Scribe'" });
    expect(
      parseInvitationRequest({ email: 'friend@example.com', workspace: { id: '', role: 'Viewer' } }),
    ).toEqual({ ok: false, error: 'workspace must be {id, role}' });
  });

  it(`U984: a note over ${INVITATION_NOTE_MAX} characters is refused; exactly ${INVITATION_NOTE_MAX} passes`, () => {
    const atLimit = 'x'.repeat(INVITATION_NOTE_MAX);
    expect(parseInvitationRequest({ email: 'a@b.co', note: atLimit })).toMatchObject({ ok: true });
    const over = parseInvitationRequest({ email: 'a@b.co', note: `${atLimit}x` });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain(String(INVITATION_NOTE_MAX));
    expect(parseInvitationRequest({ email: 'a@b.co', note: 42 })).toMatchObject({ ok: false });
  });
});

describe('PRD 017 §Invitations Req 29 message template and redirect origin', () => {
  it('U985: the mail body names the inviter and Marky Mark, with the optional note on its own paragraph', () => {
    expect(invitationMessage('Katherine Johnson')).toBe(
      'Katherine Johnson has invited you to collaborate in Marky Mark.',
    );
    expect(invitationMessage('Katherine Johnson', 'See the Q3 notes.')).toBe(
      'Katherine Johnson has invited you to collaborate in Marky Mark.\n\nSee the Q3 notes.',
    );
    // A blank note adds nothing — no trailing whitespace in the mail.
    expect(invitationMessage('K', '   ')).toBe('K has invited you to collaborate in Marky Mark.');
  });

  it('U986: deploymentOrigin is the Host with a trailing slash — first x-forwarded-proto value, http without a proxy', () => {
    expect(deploymentOrigin('localhost:4924')).toBe('http://localhost:4924/');
    expect(deploymentOrigin('markymark.azurewebsites.net', 'https')).toBe(
      'https://markymark.azurewebsites.net/',
    );
    expect(deploymentOrigin('markymark.azurewebsites.net', 'https, http')).toBe(
      'https://markymark.azurewebsites.net/',
    );
    expect(deploymentOrigin(undefined)).toBe('http://localhost/');
  });
});

describe('PRD 017 §Invitations Req 32 invite-row predicate', () => {
  const results = [{ id: 'mock-mary' }];

  it('U987: the row is offered exactly to an admin whose query is an unmatched, syntactically valid email', () => {
    expect(offersInviteRow({ admin: true }, 'friend@example.com', [])).toBe(true);
    // Non-admins never see the row, whatever they type.
    expect(offersInviteRow({ admin: false }, 'friend@example.com', [])).toBe(false);
    expect(offersInviteRow(null, 'friend@example.com', [])).toBe(false);
    // A query with a directory match is an add, not an invite.
    expect(offersInviteRow({ admin: true }, 'friend@example.com', results)).toBe(false);
    // A non-email query offers nothing.
    expect(offersInviteRow({ admin: true }, 'friend', [])).toBe(false);
    expect(isInvitableEmail(' friend@example.com ')).toBe(true);
  });
});
