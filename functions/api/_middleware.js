import { withRequestLogging } from '../_lib/logger.js'

export async function onRequest(context) {
  return withRequestLogging(context, () => context.next())
}
