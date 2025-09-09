import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'

export const makeTempDir = (prefix = 'dilagent-') => {
  return fs.mkdtempSync(Path.join(os.tmpdir(), prefix))
}
