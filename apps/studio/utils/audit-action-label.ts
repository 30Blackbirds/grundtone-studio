// i18n key for an audit action's label. The actions contain dots
// ('config.published'), and vue-i18n reads `audit.actions.config.published` as
// a nested path that does not exist, so the raw key was rendered. The bracket
// form addresses the dotted key literally.
export function auditActionKey(action: string): string {
  return `audit.actions['${action}']`
}
