# bibi-bot

A Discord moderation and stats bot. Fork of
[0-don/coding.global-bot](https://github.com/0-don/coding.global-bot) — see
[NOTICE](NOTICE) for what that means for reuse.

## Setup

### Prerequisites

1. **Discord bot token** from the [Discord Developer Portal](https://discord.com/developers/applications)
2. **PostgreSQL** database — hosted (Neon and similar work fine) or local
3. **Bun** runtime

The bot also needs the **View Audit Log** permission. Without it kicks, bans and
timeouts are still logged, but with no moderator or reason attached.

### Getting started

1. Duplicate `.env.example` as `.env` and fill it in.

2. Install dependencies:

   ```sh
   bun install
   ```

3. Start it:

   ```sh
   bun run dev
   ```

   Migrations run automatically on boot and are awaited before the bot logs in,
   so a fresh database builds itself. There is no separate migration step.

4. Run `!verify-users` in Discord to populate member data. The background queue
   only updates members who trigger an event, so existing quiet members stay
   empty until this full sync runs.

### Health checks

The bot serves two endpoints on port 4000 (`HEALTH_PORT` to change):

| Endpoint        | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `/health`       | Liveness. Touches nothing external, so it is cheap to poll.              |
| `/health/ready` | Readiness. Adds a database round trip — for deploy checks, not monitors. |

Both answer `503` rather than `200` when the Discord gateway is down: a bot that
cannot receive a message is not healthy, and a monitor checking only for a
response would never notice.

## Commands

### Public

| Command          | Description                                            | Options                   |
| ---------------- | ------------------------------------------------------ | ------------------------- |
| `/stats me`      | Your stats                                             |                           |
| `/stats user`    | Stats for a specific member                            | `user`                    |
| `/stats top`     | Top stats for the guild                                | `lookback` (optional)     |
| `/stats members` | Member flow and count                                  |                           |
| `/warnings`      | Your warnings — or another member's, with Manage Roles | `user`, `page` (optional) |
| `/report`        | Report a member to the moderators                      | `user`, `reason`          |
| `/time`          | Current time around the world, or one place            | `location` (optional)     |
| `/privacy`       | See or change what the bot stores about you            | subcommands below         |
| `/lookback-me`   | Change your own lookback range                         | `lookback`                |
| `/status`        | Bot CPU and memory                                     |                           |

`/privacy status`, `/privacy optout` and `/privacy optin` take a `scope` of
`message`, `presence` or `all`. Opting out of `message` deletes what is already
stored and stops future storage.

### Moderator (Manage Roles)

| Command            | Description                                      | Options                                      |
| ------------------ | ------------------------------------------------ | -------------------------------------------- |
| `/warn`            | Warn a member                                    | `user`, `reason`                             |
| `/delete-warning`  | Delete one warning by ID                         | `warning_id`                                 |
| `/edit-warning`    | Change a warning's reason                        | `warning_id`, `new_reason`                   |
| `/top-warnings`    | Most-warned leaderboard                          | `page` (optional)                            |
| `/jail`            | Jail a member, optionally purging their messages | `user`, `user-id`, `reason`, `purge`, `days` |
| `/unjail`          | Release a member from jail                       | `user`, `user-id`, `reason`                  |
| `/delete-messages` | Bulk-delete from a channel                       | `amount`                                     |
| `/logs commands`   | Command history                                  | `count` (optional)                           |
| `!verify-users`    | Full member resync (prefix command)              |                                              |

### Administrator

| Command             | Description                                | Options                    |
| ------------------- | ------------------------------------------ | -------------------------- |
| `/clear-warnings`   | Wipe a member's warnings                   | `user`                     |
| `/logs deleted`     | Deleted message content                    | `count` (optional)         |
| `/lookback-members` | Change the guild-wide lookback range       | `lookback`                 |
| `/delete-member-db` | Remove a member from the database          | `user`                     |
| `/audit-roles`      | Audit roles for elevated permissions       |                            |
| `/troll-move-user`  | Move a member between empty voice channels | `user`, `count`, `timeout` |

`defaultMemberPermissions` is only a default. Discord lets you override any
command per role under **Server Settings → Integrations → bibi → Command
Permissions**, which is the better place to tune access — it takes effect
immediately and needs no redeploy.

## Moderation behaviour

**Filters stop at the first one that acts.** AI spam, duplicate spam and the
invite filter run in that order; whichever acts first deletes the message and
returns, so a single message cannot be punished twice or banked as XP.

**Exemptions are one concept.** `SPAM_EXEMPT_CHANNELS` and `SPAM_EXEMPT_ROLES`
skip every filter, including the invite filter and message edits.

**Staff are warned but never auto-punished.** Anyone holding a `STAFF_ROLES`
role still gets warnings recorded, but the bot will never jail them or delete
their messages on its own. Moderators can still act on them by hand.

**Jailing protects some channels, and protects more of them for established
members.** Jailing otherwise deletes the member's last 14 days of messages in
every channel, and none of it comes back.

| List                      | Applies to                                    |
| ------------------------- | --------------------------------------------- |
| `DELETE_NEVER_CHANNELS`   | Everyone. Never swept.                        |
| `DELETE_EXEMPT_CHANNELS`  | Only members holding a `DELETE_EXEMPT_ROLES` role. |

So a long-standing member keeps their contributions to the channels that
matter, while a raider holding nothing but the base member role has everything
removed. Leaving `DELETE_EXEMPT_ROLES` empty applies the exemption to everyone.

Both lists match a channel name **or a category name**, threads inherit their
parent's protection, and a thread the member owns inside a protected channel is
kept rather than deleted. Discord's own system messages — join notices, boosts,
pins — are never deleted anywhere; they carry the member as their author but
removing them only leaves holes in the server's record.

The role is read **before** the jail is applied, because applying it strips
every other role the member holds — asking afterwards would find no OG role on
anyone.

`STAFF_ROLES` does **not** grant this automatically. Staff are already never
auto-jailed, but a moderator can still jail a colleague by hand, and that path
is deliberately exempt from the staff guard — so list the staff roles in
`DELETE_EXEMPT_ROLES` too if you want their history to survive that. The boot
check reports any name in either list that matches no role.

**Warnings have one source of truth.** `MemberWarning` rows are authoritative;
`memberGuild.warnings` is a derived counter kept in sync from them.

## Logging

Moderation actions go to `MOD_LOG_CHANNELS` and are written to the `ModLog`
table — the row is the record, the embed is a best-effort mirror. Kicks, bans,
unbans and timeouts are attributed via the audit log.

Ambient events — joins, leaves, nickname changes, message edits and deletions —
go to `SERVER_LOG_CHANNELS` (falling back to `JOIN_EVENT_CHANNELS`) and are
**not** stored, deliberately.

`LOG_EXEMPT_CHANNELS` excludes channels from that ambient logging, matching a
channel name **or a category name** — naming a staff category covers every
channel inside it, including ones added later. Deleted messages from exempt
channels are not stored either, so they cannot be retrieved with `/logs deleted`.

## Configuration

Everything lives in your environment file; see `.env.example` for the full list.
The ones worth knowing:

| Variable                     | Effect when unset                                        |
| ---------------------------- | -------------------------------------------------------- |
| `GUILD_ID`                   | Required. Comma-separated for multiple servers.           |
| `STATUS_ROLES`               | Needs a `jail` entry or jailing silently does nothing.    |
| `STAFF_ROLES`                | No staff exemption from automated punishment.            |
| `LOG_EXEMPT_CHANNELS`        | Everything is logged, staff channels included.           |
| `DELETE_EXEMPT_CHANNELS`     | Jailing sweeps every channel, announcements included.    |
| `DELETE_EXEMPT_ROLES`        | The exemption above applies to everyone, not just OGs.   |
| `DELETE_NEVER_CHANNELS`      | No channel is protected unconditionally.                 |
| `BACKGROUND_WORKERS_ENABLED` | Defaults on. `false` stops member data ever updating.    |
| `TEMPLATE_VALIDATION_BOARDS` | Empty = off. Enables AI template checks on forum boards. |
| `PRIVILEGED_INTENTS_ENABLED` | Defaults on. `false` runs in limited mode, filters off.  |

Role and channel names are matched **exactly**. On boot the bot checks each
configured name against every guild and reports what does not resolve — worth
reading, because a name that does not match fails silently otherwise.

## Licence

MIT for the work in this fork — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
