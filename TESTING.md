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

## Still open

Not defects, but known and unverified as of `83856b4`:

- Member `856483085801095198` is jailed with no `ModLog` entry, from before
  manual-jail logging existed. Past recovery from the audit log — decide by
  hand whether they should stay jailed.
- `/unjail` has no rank check, so a moderator can release someone an
  administrator jailed.
- Removing the jail role by hand is an unlogged release. Role _removal_ never
  reaches the handler that logs manual jails.
