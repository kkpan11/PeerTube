import { buildSUUID } from '@peertube/peertube-node-utils'
import express from 'express'
import { CONFIG } from '../initializers/config.js'
import { inLoggerContext } from '../helpers/logger.js'

// Tag every logger call happening while handling this request (including in async code) with a request id,
// so related log lines can be grepped/correlated together
export function requestLoggerContext (_req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId = buildSUUID()

  res.setHeader('X-Request-Id', requestId)

  if (!CONFIG.LOG.TAG_REQUESTS) return next()

  inLoggerContext([ 'req', requestId ], () => next())
}
