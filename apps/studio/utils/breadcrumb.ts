// Breadcrumb for the signed-in shell, following the redesign prototypes
// (docs/design/grundtone-studio/prototypes): "org › Section" on org pages and
// "org › Projekter › project" inside a project. The current page is the last
// item and has no link. Every other item MUST have a link: GTBreadcrumb marks
// any item without `to`/`href` as the current page (aria-current="page").

export interface BreadcrumbItem {
  label: string
  to?: string
}

export interface BreadcrumbInput {
  path: string
  orgSlug: string | null | undefined
  orgName: string | null | undefined
  projectSlug: string | null | undefined
  projectName: string | null | undefined
  t: (key: string) => string
}

// Second path segment after /orgs/<slug>/ → i18n key of the section title.
export const SECTION_LABELS: Record<string, string> = {
  members: 'members.title',
  billing: 'billing.nav',
  settings: 'orgSettings.title',
  audit: 'audit.title',
}

export function buildBreadcrumb(input: BreadcrumbInput): BreadcrumbItem[] {
  const { path, orgSlug, orgName, projectSlug, projectName, t } = input
  if (!orgSlug) return []

  const orgHref = `/orgs/${orgSlug}`
  const orgLabel = orgName || orgSlug
  const org: BreadcrumbItem = { label: orgLabel, to: orgHref }

  if (projectSlug) {
    return [org, { label: t('projects.title'), to: orgHref }, { label: projectName || projectSlug }]
  }

  const section = path.split('/')[3] ?? ''
  const sectionKey = SECTION_LABELS[section]
  if (sectionKey) return [org, { label: t(sectionKey) }]

  // The org index is the project list.
  if (path === orgHref || path === `${orgHref}/`) return [org, { label: t('projects.title') }]

  return [{ label: orgLabel }]
}
