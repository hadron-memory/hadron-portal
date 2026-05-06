// 010-create-node-on-portal — i18n strings for the create-node flow.
// Pattern matches install-strings.ts: each user-visible string routes through
// t(id, defaultText) per Constitution Principle III.

import { t } from './t';

export const nodeCreateStrings = {
  affordanceLabel: (): string => t('nodes.create.affordance.label', 'Add child'),
  affordanceAria: (parentTitle: string): string =>
    t('nodes.create.affordance.aria', `Add child node to ${parentTitle}`),

  heading: (parentTitle: string): string =>
    t('nodes.create.heading', `New node under ${parentTitle}`),
  headingNoParent: (): string => t('nodes.create.heading.noParent', 'New node'),

  fieldTitleLabel: (): string => t('nodes.create.field.title.label', 'Title'),
  fieldTitlePlaceholder: (): string =>
    t('nodes.create.field.title.placeholder', 'A short, descriptive title'),
  fieldTypeLabel: (): string => t('nodes.create.field.type.label', 'Type'),
  fieldParentLabel: (): string => t('nodes.create.field.parent.label', 'Parent'),
  fieldParentNone: (): string => t('nodes.create.field.parent.none', '(top level)'),

  typeHelpInfo: (): string =>
    t(
      'nodes.create.type.help.info',
      'A piece of knowledge — facts, notes, links, anything you want to remember.',
    ),
  typeHelpRecord: (): string =>
    t(
      'nodes.create.type.help.record',
      'A captured event or observation. Typically system-managed; choose only if you know you need this.',
    ),
  typeHelpSystem: (): string =>
    t(
      'nodes.create.type.help.system',
      'A platform-managed node (chats, sessions, internal state). Typically system-managed; choose only if you know you need this.',
    ),
  typeHelpReference: (): string =>
    t(
      'nodes.create.type.help.reference',
      'A pointer to something stored elsewhere (a file, an external resource, another node).',
    ),

  buttonCreate: (): string => t('nodes.create.button.create', 'Create'),
  buttonCancel: (): string => t('nodes.create.button.cancel', 'Cancel'),

  errorTitleRequired: (): string =>
    t('nodes.create.error.titleRequired', 'Title is required.'),
  errorTitleEmptySlug: (): string =>
    t(
      'nodes.create.error.titleEmptySlug',
      'Title must contain at least one letter or digit.',
    ),
  errorTypeRequired: (): string =>
    t('nodes.create.error.typeRequired', 'Type is required.'),
  errorInvalidType: (): string =>
    t(
      'nodes.create.error.invalidType',
      "That type isn't supported. Choose one of: info, record, system, reference.",
    ),
  errorParentMissing: (): string =>
    t(
      'nodes.create.error.parentMissing',
      'Parent node not found. It may have been deleted.',
    ),
  errorPermissionDenied: (): string =>
    t(
      'nodes.create.error.permissionDenied',
      "You don't have permission to add a child here.",
    ),
  errorNetwork: (): string =>
    t('nodes.create.error.network', "Couldn't reach the server. Try again."),
  errorLocCollisionExhausted: (): string =>
    t(
      'nodes.create.error.locCollisionExhausted',
      'Too many siblings with similar titles. Try a more distinctive title.',
    ),
};
