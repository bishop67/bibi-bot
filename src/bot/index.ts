// Events
import "./events/_ready";
import "./events/ai-chat";
import "./events/guild-ban-add";
import "./events/guild-ban-remove";
import "./events/guild-member-add";
import "./events/guild-member-remove";
import "./events/guild-member-update";
import "./events/message-create";
import "./events/message-delete";
import "./events/message-reaction-add";
import "./events/message-update";
import "./events/presence-update";
import "./events/thread-create";
import "./events/user-update";
import "./events/voice-stateupdate";

// Commands - Admin
import "./commands/admin/audit-roles";
import "./commands/admin/troll-move-user";

// Commands - Mod
import "./commands/mod/clear-warnings";
import "./commands/mod/delete-member-db";
import "./commands/mod/delete-messages";
import "./commands/mod/jail";
import "./commands/mod/unjail";
import "./commands/mod/delete-warning";
import "./commands/mod/edit-warning";
import "./commands/mod/logs";
import "./commands/mod/lookback-members";
import "./commands/mod/status";
import "./commands/mod/top-warnings";
import "./commands/mod/verify-users";
import "./commands/mod/warn";
import "./commands/mod/warnings";

// Commands - User
import "./commands/user/lookback-me";
import "./commands/user/privacy";
import "./commands/user/stats";
import "./commands/user/report";
import "./commands/user/time";