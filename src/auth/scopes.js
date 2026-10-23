export const SCOPES = {
  elder: 'saathi/elder',
  family: 'saathi/family',
};

export const ALL_SCOPES = Object.values(SCOPES);

export const TOOL_SCOPES = {
  what_day_is_it: SCOPES.elder,
  who_is: SCOPES.elder,
  get_medication_schedule: SCOPES.elder,
  confirm_medication_taken: SCOPES.elder,
  daily_check_in: SCOPES.elder,
  ask_family_for_help: SCOPES.elder,
  get_family_messages: SCOPES.elder,
  send_message_to_family: SCOPES.elder,
  save_memory_story: SCOPES.elder,
  list_memory_stories: SCOPES.elder,
  family_summary: SCOPES.family,
  acknowledge_alert: SCOPES.family,
};

export function hasScope(authInfo, scope) {
  return !authInfo || authInfo.scopes.includes(scope);
}
