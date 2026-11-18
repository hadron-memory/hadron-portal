/**
 * portal#1496 (MCP cut P1, hadron-server#2937): the 71 agent-team MCP tools
 * that phase 3 (S1) switches off. Text the portal ships to people and agents
 * must not send them to any of these.
 *
 * Source: plan rev 2,
 * hrn:node:hadronmemory.com:hadron-dev-team-shared:plans:mcp-team-cut
 * ("The tool list"), from inventory rev 1,
 * hrn:node:hadronmemory.com:hadron-dev-team-petra:drafts:mcp-team-inventory.
 *
 * A pinned copy of the ruled list: a change to it is a new plan revision or a
 * Holger ruling, and the header above names the one this copy follows. Slice P2
 * (portal#1550) holds it equal to what S1's switch disabled at hadron-server
 * 99246d46, in hosted-mcp-tools.test.ts.
 *
 * Names are written out in full, never built from a prefix, so a search for any
 * one of them finds it.
 */
export const DISABLED_TEAM_TOOLS: ReadonlySet<string> = new Set([
  // Sessions and workers
  'hadron_resume_session',
  'hadron_create_resume_claim',
  'hadron_record_work',
  'hadron_team_work_items',
  'hadron_cast_worker',
  'hadron_list_workers',
  'hadron_get_worker',
  'hadron_update_worker',
  'hadron_delete_worker',
  'hadron_change_worker_agent',
  'hadron_set_worker_reports_to',
  // Channels and chat
  'hadron_list_channels',
  'hadron_create_channel',
  'hadron_register_list',
  'hadron_register_add',
  'hadron_register_remove',
  'hadron_channel_post',
  'hadron_channel_read',
  'hadron_team_chat_post',
  'hadron_team_chat_read',
  'hadron_team_chat_search',
  'hadron_team_chat_mark_read',
  'hadron_team_chat_inbox',
  'hadron_team_chat_inbox_ack',
  // Attention
  'hadron_team_attention',
  'hadron_team_attention_page',
  'hadron_team_attention_switchover',
  // Tasks
  'hadron_task_create',
  'hadron_task_update',
  'hadron_task_assign',
  'hadron_task_reassign',
  'hadron_task_blocker_add',
  'hadron_task_blocker_remove',
  'hadron_task_priority_set',
  'hadron_task_start',
  'hadron_task_progress',
  'hadron_task_finish',
  'hadron_task_cancel',
  'hadron_task_park',
  'hadron_task_make_ready',
  'hadron_task_get',
  'hadron_task_list',
  // Roster, events, alarms and availability
  'hadron_team_events',
  'hadron_alarm_ack',
  'hadron_team_roster',
  'hadron_team_availability',
  'hadron_worker_availability_set',
  'hadron_model_family_availability_set',
  'hadron_stall_schedule_get',
  'hadron_stall_schedule_set',
  // Stop signals, pause and isolation
  'hadron_stop_signal_set',
  'hadron_stop_signal_lift',
  'hadron_stop_signal_list',
  'hadron_set_team_pause',
  'hadron_isolate_worker',
  'hadron_clear_worker_isolation',
  // Tickers and wakes
  'hadron_ticker_list',
  'hadron_ticker_create',
  'hadron_ticker_update',
  'hadron_ticker_delete',
  'hadron_ticker_subscribe',
  'hadron_ticker_unsubscribe',
  'hadron_worker_wake_settings',
  'hadron_due_wakes',
  'hadron_ack_wakes',
  'hadron_delivery_settings_get',
  'hadron_delivery_settings_set',
  'hadron_agent_ticker_template_list',
  'hadron_agent_ticker_template_create',
  'hadron_agent_ticker_template_update',
  'hadron_agent_ticker_template_delete',
]);

/**
 * The disabled tools a text names, each once. A name counts wherever it
 * appears (a table, prose or a code span), because an agent reading the text
 * acts on all of them.
 */
export function disabledToolsIn(text: string): string[] {
  const named = new Set(text.match(/hadron_[a-z_]+/g) ?? []);
  return [...named].filter((n) => DISABLED_TEAM_TOOLS.has(n));
}
