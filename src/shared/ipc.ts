/**
 * Channel names shared by the preload bridge and the main process.
 * Renderer code never touches these strings directly.
 */
export const CHANNELS = {
  bootstrap: 'app:bootstrap',
  projectsList: 'projects:list',
  projectUpdate: 'project:update',
  projectDelete: 'project:delete',
  skeletonCreate: 'skeleton:create',
  bookCreate: 'book:create',
  readerRead: 'reader:read',
  readerEnter: 'reader:enter',
  readChapter: 'chapter:read',
  chapterRequest: 'chapter:request',
  chapterCancel: 'chapter:cancel',
  chapterRegenerate: 'chapter:regenerate',
  chapterDelete: 'chapter:delete',
  chapterOutline: 'chapter:outline',
  cursorUpdate: 'cursor:update',
  settingsSave: 'settings:save',
  modelTest: 'model:test',
  directiveCreate: 'directive:create',
  directiveDeactivate: 'directive:deactivate',
  beats: 'beats:create',
  rewriteSelect: 'rewrite:select',
  rewritePreview: 'rewrite:preview',
  rewriteManual: 'rewrite:manual',
  rewriteApply: 'rewrite:apply',
  rewriteDiscard: 'rewrite:discard',
  rewriteFix: 'rewrite:fix',
  versionsList: 'versions:list',
  versionsGet: 'versions:get',
  versionsRestore: 'versions:restore',
  staleAction: 'stale:action',
  usageGet: 'usage:get',
  exportBook: 'book:export',
  dataFolder: 'data:folder',
  event: 'app:event'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
