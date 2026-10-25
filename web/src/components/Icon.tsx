/**
 * Icon set — inline SVG, stroke-based (Win11 Fluent style). No icon library.
 * Usage: <Icon name="file" size={16} />
 */
import React from 'react'

const P: Record<string, React.ReactNode> = {
  // files & navigation
  'file': <><path d="M7 2h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" /><path d="M13 2v5h5" /></>,
  'file-plus': <><path d="M7 2h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" /><path d="M13 2v5h5" /><path d="M12 11v6M9 14h6" /></>,
  'file-text': <><path d="M7 2h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" /><path d="M13 2v5h5" /><path d="M9 12h6M9 16h6M9 8h2" /></>,
  'folder': <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />,
  'folder-open': <><path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2H3V6Z" /><path d="M3 10h18l-2 9H4l-1-9Z" /></>,
  'folder-plus': <><path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" /><path d="M12 11v5M9.5 13.5h5" /></>,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-up': <path d="m5 15 7-7 7 7" />,
  'arrow-left': <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  'more': <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  'more-vert': <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,

  // actions
  'plus': <path d="M12 5v14M5 12h14" />,
  'minus': <path d="M5 12h14" />,
  'check': <path d="m4 12 5 5L20 6" />,
  'x': <path d="M6 6l12 12M18 6 6 18" />,
  'search': <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  'command': <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />,
  'settings': <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  'refresh': <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  'sync': <><path d="M4 12a8 8 0 0 1 13.6-5.7L21 9" /><path d="M21 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.6 5.7L3 15" /><path d="M3 20v-5h5" /></>,
  'save': <><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M8 3v6h7V3" /><path d="M8 14h8v7H8z" /></>,
  'download': <><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
  'upload': <><path d="M12 21V9" /><path d="m7 13 5-5 5 5" /><path d="M4 4h16" /></>,
  'trash': <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></>,
  'edit': <><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m13 5 4 4" /></>,
  'copy': <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  'scissors': <><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><path d="M8 8l12 12M8 16 20 4" /></>,
  'paste': <><path d="M9 4h6v3H9z" /><path d="M9 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" /></>,
  'eye': <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8" /><path d="M6.2 6.6A17 17 0 0 0 2 12s4 6 10 6a9.6 9.6 0 0 0 4-.9" /></>,
  'lock': <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  'unlock': <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>,
  'link': <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>,
  'external': <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  'share': <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></>,
  'tag': <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="8" cy="8" r="1.4" /></>,
  'hash': <path d="M5 9h14M5 15h14M10 4 8 20M17 4l-2 16" />,
  'bookmark': <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  'star': <path d="m12 3 2.8 6 6.2.7-4.6 4.3 1.3 6-5.7-3.2L6.3 20l1.3-6L3 9.7 9.2 9 12 3Z" />,
  'history': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /><path d="M3 7v4h4" /></>,
  'clock': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
  'calendar': <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  'sort': <><path d="M7 4v16" /><path d="m4 7 3-3 3 3" /><path d="M13 8h7M13 12h5M13 16h3" /></>,
  'sort-asc': <><path d="m8 9 4-4 4 4" /><path d="M12 5v14" /><path d="M4 20h16" /></>,
  'sort-desc': <><path d="m8 15 4 4 4-4" /><path d="M12 19V5" /><path d="M4 4h16" /></>,
  'layout-left': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  'layout-right': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  'layout-both': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16" /></>,
  'columns': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  'rows': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" /></>,
  'maximize': <><path d="M4 9V4h5" /><path d="M20 15v5h-5" /><path d="M15 4h5v5" /><path d="M9 20H4v-5" /></>,
  'minimize': <><path d="M9 4v5H4" /><path d="M15 20v-5h5" /><path d="M20 9h-5V4" /><path d="M4 15h5v5" /></>,
  'window': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /></>,
  'sidebar': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  'grip': <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  'list': <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  'list-ordered': <><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 5h1v4M4 15h2M4 17h2M4 13h2" /></>,
  'list-todo': <><rect x="3" y="4" width="5" height="5" rx="1" /><rect x="3" y="15" width="5" height="5" rx="1" /><path d="M11 6.5h10M11 17.5h10" /></>,
  'headings': <><path d="M4 5v14M12 5v14M4 12h8" /><path d="M17 9h4l-4 5h4" /></>,
  'quote': <><path d="M8 6H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3V6Z" /><path d="M8 11c0 4-2 6-4 7" /><path d="M19 6h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3V6Z" /><path d="M19 11c0 4-2 6-4 7" /></>,
  'code': <><path d="m8 8-5 4 5 4" /><path d="m16 8 5 4-5 4" /></>,
  'code-block': <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m8 10-2 2 2 2M16 10l2 2-2 2" /></>,
  'bold': <><path d="M7 4h6a4 4 0 0 1 0 8H7z" /><path d="M7 12h7a4 4 0 0 1 0 8H7z" /></>,
  'italic': <path d="M10 4h8M6 20h8M15 4 9 20" />,
  'strike': <><path d="M5 12h14" /><path d="M16 7a4 4 0 0 0-4-3h-1a3.5 3.5 0 0 0-1 6.9" /><path d="M8 17a4 4 0 0 0 4 3h1a3.5 3.5 0 0 0 1-6.9" /></>,
  'highlight': <><path d="m9 14 8-8 3 3-8 8H9v-3Z" /><path d="M4 20h16" /></>,
  'table': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></>,
  'image': <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
  'video': <><rect x="2" y="6" width="13" height="12" rx="2" /><path d="m15 10 7-4v12l-7-4z" /></>,
  'mic': <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v4M8 22h8" /></>,
  'volume': <><path d="M4 9v6h4l6 4V5L8 9H4Z" /><path d="M17 9a4 4 0 0 1 0 6" /><path d="M19.5 6.5a8 8 0 0 1 0 11" /></>,
  'formula': <><path d="M4 20 12 4l8 16" /><path d="M7 14h10" /></>,
  'footnote': <><path d="M6 5h10M6 12h7M6 19h4" /><path d="M16 16h4v4h-4z" /></>,
  'hr': <><path d="M3 12h18" /><path d="M6 7h12M6 17h12" opacity=".35" /></>,
  'undo': <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12H8" /></>,
  'redo': <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a6 6 0 0 0 0 12h5" /></>,
  'ai': <><path d="M12 3v3M12 18v3M4.2 7.2l2.1 2.1M17.7 14.7l2.1 2.1M3 12h3M18 12h3M4.2 16.8l2.1-2.1M17.7 9.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></>,
  'sparkles': <><path d="m12 3 1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /><path d="m18.5 15.5.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z" /></>,
  'send': <><path d="M21 3 3 10l7 3 3 7 8-17Z" /><path d="m10 13 5-5" /></>,
  'robot': <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /><path d="M9 17h6" /></>,
  'user': <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  'users': <><circle cx="9" cy="8" r="3.6" /><path d="M2 20a7 7 0 0 1 14 0" /><path d="M17 5.2A3.6 3.6 0 0 1 17 12" /><path d="M18 14.5A6 6 0 0 1 22 20" /></>,
  'shield': <><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  'key': <><circle cx="8" cy="8" r="4" /><path d="m11 11 9 9M17 17l2-2M14 14l2-2" /></>,
  'credit-card': <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
  'coins': <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M3 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><path d="M21 12v5c0 1.7-2 3-4 3" /><ellipse cx="16" cy="9" rx="5" ry="2.6" /></>,
  'chart': <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  'database': <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  'cloud': <path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 .5 8.5H7Z" />,
  'server': <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01" /></>,
  'puzzle': <path d="M9 3a2 2 0 0 1 3.5 1.2c0 .6-.3 1-.3 1.4 0 .6.5 1 1 1H16a1 1 0 0 1 1 1v3c0 .6.5 1 1 1h.5A2 2 0 0 1 20 15a2 2 0 0 1-1.5 3.4H18c-.6 0-1 .4-1 1V20a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1v-.6c0-.6-.4-1-1-1h-.4A2 2 0 0 1 8 15a2 2 0 0 1 1.7-2.8c.4 0 .8.2 1.2 0 .4-.2.6-.6.6-1V9c0-.6-.5-1-1-1h-.3c-.6 0-1-.4-1-1V6A3 3 0 0 1 9 3Z" />,
  'grid': <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  'graph': <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="m8.4 6.6 7.1.6M7.3 8.3l3.6 7.4M16.6 9.2l-3.2 6.6" /></>,
  'canvas': <><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M8 9h3v3H8zM14 6h4v4h-4zM13 15h5v3h-5z" /><path d="M11 10.5 14 8M11 11.5l2 3.5" /></>,
  'presentation': <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M12 17v4M8 21h8" /></>,
  'slides': <><rect x="3" y="3" width="18" height="12" rx="2" /><path d="M7 18h10M12 15v3" /></>,
  'browser': <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20" /><circle cx="5.5" cy="6.5" r=".8" /><circle cx="8.5" cy="6.5" r=".8" /></>,
  'globe': <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" /></>,
  'wifi': <><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19.5" r="1" /></>,
  'cpu': <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  'hard-drive': <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 13h20" /><path d="M6 16.5h.01M10 16.5h.01" /></>,
  'bell': <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  'logout': <><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" /><path d="M10 12H3" /><path d="m6 8-4 4 4 4" /></>,
  'login': <><path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" /><path d="M14 12H6" /><path d="m17 8 4 4-4 4" /></>,
  'info': <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  'alert': <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  'help': <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.3" /><path d="M12 17h.01" /></>,
  'pin': <><path d="M12 17v5" /><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z" /></>,
  'panel-bottom': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15h18" /></>,
  'panel-top': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  'zoom-in': <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6M11 8v6" /></>,
  'zoom-out': <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></>,
  'filter': <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  'camera': <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></>,
  'play': <path d="M6 4l14 8-14 8V4Z" />,
  'pause': <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
  'stop': <rect x="5" y="5" width="14" height="14" rx="2" />,
  'shuffle': <><path d="M3 6h4l10 12h4" /><path d="m18 3 3 3-3 3" /><path d="M3 18h4l2.5-3" /><path d="m18 15 3 3-3 3" /><path d="M14 8.5 16.5 6" /></>,
  'layers': <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  'sliders': <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  'monitor': <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  'smartphone': <><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></>,
  'apple': <><path d="M16.4 12.7c0 2.6 2.1 3.5 2.2 3.5 0 .1-.4 1.3-1.3 2.5-.8 1.2-1.7 2.3-3 2.3-1.3 0-1.7-.8-3.2-.8-1.5 0-2 .8-3.2.8-1.3 0-2.2-1.2-3-2.4-1.7-2.4-3-6.8-1.2-9.6A4.6 4.6 0 0 1 7.6 6c1.3 0 2.5.9 3.2.9.7 0 2.2-1.1 3.7-1 .6 0 2.4.3 3.6 1.8-2.2 1.3-1.7 4.2-1.7 5Z" /><path d="M14 3.2c.7-.9 1.2-2 1-3.2-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" /></>,
  'windows': <><path d="M3 5.5 10.5 4.5v7H3v-6Z" /><path d="M12.5 4.2 21 3v8.5h-8.5v-7.3Z" /><path d="M3 13h7.5v7L3 19v-6Z" /><path d="M12.5 13H21v8.5l-8.5-1.2V13Z" /></>,
  'android': <><path d="M5 11a7 7 0 0 1 14 0v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6Z" /><path d="M7.5 6.5 6 4M16.5 6.5 18 4" /><path d="M9.5 13h.01M14.5 13h.01" /></>,
  'linux': <><path d="M12 2c-2.5 0-3.5 2-3.5 5 0 2-2.5 4.5-2.5 8 0 7 2 7 4 7 1.2 0 1.5-1 2-1s1 1 2 1c2 0 4 0 4-7 0-3.5-2.5-6-2.5-8 0-3-1-5-3.5-5Z" /><path d="M10 10h.01M14 10h.01" /></>
}

export type IconName = keyof typeof P | string

interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  strokeWidth?: number
  filled?: boolean
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, strokeWidth = 1.7, filled = false, ...rest }) => {
  const node = P[name as string] || P['file']
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {node}
    </svg>
  )
}

export default Icon
