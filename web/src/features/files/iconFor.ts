/**
 * Path → icon mapping shared by tabs, the file tree and search results.
 */
export function iconForPath(path: string): string {
  const name = (path.split('/').pop() || '').toLowerCase()
  if (!name) return 'file'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'md':
    case 'mdx':
    case 'markdown':
      return 'file-text'
    case 'txt':
      return 'file'
    case 'canvas':
      return 'canvas'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image'
    case 'pdf':
      return 'file-text'
    case 'json':
    case 'csv':
    case 'xlsx':
      return 'table'
    case 'html':
    case 'htm':
      return 'browser'
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'css':
    case 'py':
    case 'go':
    case 'java':
      return 'code'
    default:
      return 'file'
  }
}

export default iconForPath
