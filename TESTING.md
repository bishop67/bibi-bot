# bibi-bot — test checklist

Covers everything changed on `main` up to `83856b4`.

**Before starting**

- [ ] Throwaway alt with only `HEX4`
- [ ] Second alt you can grant `OG`
- [ ] Bibi has **View Audit Log** (section 3 degrades silently without it)
- [ ] Note where Bibi's role sits vs `require('Admin');`

> Section 1 deletes messages irreversibly. Use alts, not real members.

## 1. Jail message sweep

- [ ] **1a** HEX4-only alt posts in `#general`, `#announcement`, a `#hacking` forum post, `#spam` → `/jail` → **everything deleted**, protected channels included
- [ ] **1b** Give alt `OG`, repeat, `/jail` → `#announcement`, `#hacking`, `#memes` **kept**; `#general` and `#spam` deleted
- [ ] **1c** Same with `@Moderator;` instead of `OG` → same result as 1b
- [ ] **1d** `#welcome` join notices survive every jail, for everyone
- [ ] **1e** Forum thread _owned_ by a jailed OG in `Forums & Guide` → thread survives, not deleted outright

## 2. Jail rules

- [ ] **2a** `/jail` someone already jailed → refused, **no** new deletions
- [ ] **2b** `/jail` yourself → "You cannot jail yourself."
- [ ] **2c** Moderator jails another Moderator → refused (equal rank)
- [ ] **2d** Moderator jails an Admin → refused
- [ ] **2e** Admin jails a Moderator → allowed
- [ ] **2f** Owner jails anyone → allowed
- [ ] **2g** Target's top role above Bibi's → "their highest role sits above mine"
- [ ] **2h** `/jail user-id:` someone who left → allowed, DB record only

## 3. Manual jail logging

- [ ] **3a** Hand-add the `Jail` role → ModLog entry naming **you**
- [ ] **3b** Use `/jail` normally → exactly **one** entry, no duplicate
- [ ] **3c** Remove Bibi's View Audit Log, repeat 3a → entry appears, no moderator named

## 4. Unjail and levels

- [ ] **4a** `/unjail` → `HEX4` restored
- [ ] **4b** They post once → qualifying level roles return **all at once**
- [ ] **4c** Member with ≥10 stored messages posts → `Script Kiddie!` granted
- [ ] **4d** Jailed member posting → **no** level role

## 5. Commands

- [ ] **5a** Picker as HEX4-only → **no** `/status`
- [ ] **5b** Picker as Moderator → `/status` visible and works
- [ ] **5c** `/stats` each `type` → all four render; `members` includes the chart
- [ ] **5d** `/stats type:member` with no user → "Pick someone with the `user` option…"
- [ ] **5e** `/stats type:top lookback:30` → honours the window
- [ ] **5f** `/privacy` → gone entirely

## 6. Backfill

- [ ] **6a** `!backfill-messages` again → finishes almost immediately (133 recorded done)
- [ ] **6b** Run it again mid-flight → "A backfill is already running here."
- [ ] **6c** `--reset` while one runs → same refusal, record **not** cleared
- [ ] **6d** `--reset`, Ctrl+C, restart, re-run → resumes near where it stopped
- [ ] **6e** As Moderator (not Admin) → refused

## 7. Regressions

- [ ] Spam filter still deletes + warns; 4 invite warnings still auto-jails
- [ ] `OG` still exempt from every filter (`SPAM_EXEMPT_ROLES`)
- [ ] Staff still never _auto_-jailed, only manually
- [ ] `/logs deleted` still records deletions
- [ ] Startup shows `13/15`, Bot Channel Restrictions disabled

## Priority

**Don't skip 1b, 2a, 3b** — most likely to break, most costly if they do.

**Expected oddity:** in 1a/1b the alt's level count barely drops. The sweep
bulk-deletes, which doesn't fire `messageDelete`, so DB rows survive.
Deliberate — it's why levels return after unjail.

## 8. Deletion logging

Verified against the production DB on 2026-08-19: all 11 `MemberDeletedMessages`
rows were recorded as self-deletions, `by_mod = 0`. Moderator deletions had
never once been attributed.

- [ ] **8a** Delete another member's recent message → `#server-logs` names _you_
      as the deleter, not "themselves"
- [ ] **8b** Delete three of one member's messages in quick succession → all
      three log, all three name you (Discord coalesces these into one audit
      entry and bumps `extra.count`; the old check only caught the first)
- [ ] **8c** Delete a message older than the newest 50 in its channel → still
      logs, with `*(not cached - the bot did not have the message text)*`
- [ ] **8d** Delete your own message → still reads "deleted by _themselves_"
- [ ] **8e** Delete in a `LOG_EXEMPT_CHANNELS` channel → nothing logged, nothing
      stored
- [ ] **8f** `/jail` someone by hand → the `ModLog` entry names the moderator
      rather than reading "Automod"
- [ ] **8g** Auto-jail via 4 invite warnings → still reads "Automod"
- [ ] **8h** `/unjail` someone jailed by a higher-ranked moderator → refused
- [ ] **8i** Take the jail role off someone by hand → an `unjail` entry appears
      naming you; `/unjail` still logs exactly once, not twice
- [ ] **8j** Ban someone with "delete message history" → one bulk-delete summary
      naming you, with the per-author counts
- [ ] **8k** `/jail` someone with messages to sweep → bulk-delete summaries
      appear, and their level roles still return after `/unjail` (the sweep must
      leave `MemberMessages` alone)

## 9. Member count

Verified 2026-08-19: the `members:` channel read 66 against 67 real humans, and
every current member had a correct `MemberGuild` row — the count was the only
thing wrong, and it was wrong low.

- [ ] **9a** A new member joins and completes onboarding → the count goes up
- [ ] **9b** A member still behind the screening gate → count unchanged until
      they pass it, not before
- [ ] **9c** A member leaves → the count goes down
- [ ] **9d** Restart the bot → the count is recomputed from the real roster
- [ ] **9e** Several joins in quick succession → the count survives the rename
      rate limit, and any refusal shows up in the log rather than vanishing
- [ ] **9f** Stop the bot, have someone leave, start it → they are marked absent
      on boot, and bots still in the server are _not_ (dry-run against live data
      flipped exactly the 4 departed humans and left `LionBot` alone)
- [ ] **9g** Set `SHOULD_COUNT_MEMBERS=false` → members are still recorded and
      the invite filter still moderates them; only the count channel goes quiet
- [ ] **9h** `/unjail` writes exactly one `unjail` entry, not two — the handler
      that logs a hand-removed jail role must recognise it as already recorded
- [ ] **9i** `/jail` likewise writes exactly one `jail` entry, not two
- [ ] **9j** Jail by hand, release by hand, jail by hand again a minute apart →
      three separate entries, none collapsed by the duplicate window

The reconciliation is the only statement in this work that rewrites existing
rows in bulk. It is `UPDATE MemberGuild SET status = false`, scoped to one
guild, touching only rows already `true`, and it deletes nothing — the worst
case is a wrong boolean, which `/verify-users` or a clean restart repairs. It
refuses to run at all unless the fetched roster is at least `guild.memberCount`.

## Still open

Not defects, but known and unverified as of `83856b4`:

- One member holds the jail role with **no `ModLog` entry at all**:
  `1528148852971016302` (`theghost023577`). Past recovery from the audit log —
  decide by hand whether they should stay jailed. The jail date cannot be read
  from the database: `MemberRole.createdAt` tracks the last member sync, not the
  jail, so it says nothing about when they were put away.

  `856483085801095198` (`kryptos.zeta`) was also on this list and is **no longer
  jailed** — released 2026-08-19, and now has `ModLog` rows either side.
- The `/unjail` rank check reads `ModLog.moderatorId`. Every jail record
  predating the attribution fix is null, and the member above has no record at
  all, so the check is inert on those and they stay releasable by anyone. It
  protects jails made from that fix onward.
- Bulk-delete logging is a summary, by design: who ran it, which channel, and a
  per-author count. Bodies are not shown and nothing is stored, because a jail
  sweep clears a fortnight of messages a hundred at a time.
- Nineteen `Member` rows have no `MemberGuild` row — `xr874` (370 messages),
  `livingofftheland_420` (160) and others, left by the message backfill, which
  inserts `Member` to satisfy the foreign key and nothing more. Checked against
  the live roster: **all nineteen have left the server**, so this is dead
  residue rather than an automod gap. Every current member has a guild row.
