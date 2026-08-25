async function register({
  peertubeHelpers,
  registerCommentAutoTagger,
  registerVideoAutoTagger,
  getRouter
}) {
  registerCommentAutoTagger({
    autoTagNames: [ 'plugin comment auto tag' ],

    handler: async ({ comment }) => {
      if (comment && comment.text && comment.text.includes('plugin-tag-comment')) {
        return { tags: [ 'plugin comment auto tag' ] }
      }

      return { tags: [] }
    }
  })

  // Simulate an auto tagger that calls a slow external service: it must not block the comment creation
  registerCommentAutoTagger({
    autoTagNames: [ 'plugin slow comment auto tag' ],

    handler: async ({ comment }) => {
      if (!comment || !comment.text || !comment.text.includes('plugin-slow-tag-comment')) {
        return { tags: [] }
      }

      await new Promise(res => setTimeout(res, 3000))

      return { tags: [ 'plugin slow comment auto tag' ] }
    }
  })

  // Analyze the video file to decide of the tag: this runs in a job, outside of any transaction
  registerVideoAutoTagger({
    autoTagNames: [ 'plugin video file auto tag' ],

    handler: async ({ video }) => {
      if (!video || !(video.name || '').includes('analyze-video-file')) return { tags: [] }

      const files = await peertubeHelpers.videos.getFiles(video.id)
      const path = (files?.webVideo?.videoFiles || []).map(f => f.path).find(p => !!p)
      if (!path) return { tags: [] }

      const probe = await peertubeHelpers.videos.ffprobe(path)
      if (!(probe.format.duration > 0)) return { tags: [] }

      return { tags: [ 'plugin video file auto tag' ] }
    }
  })

  registerVideoAutoTagger({
    autoTagNames: [ 'plugin video auto tag' ],

    handler: async ({ video }) => {
      if (video) {
        const text = (video.name || '') + ' ' + (video.description || '')

        if (text.includes('plugin-tag-video')) {
          return { tags: [ 'plugin video auto tag' ] }
        }
      }

      return { tags: [] }
    }
  })

  const router = getRouter()

  router.get('/server-comment-tags/:commentId', async (req, res) => {
    const commentId = parseInt(req.params.commentId, 10)

    const tags = await peertubeHelpers.automaticTags.getServerCommentAutomaticTags({ commentId })

    return res.json({
      tags: tags.map(t => t.name)
    })
  })

  router.get('/account-comment-tags/:commentId', async (req, res) => {
    const commentId = parseInt(req.params.commentId, 10)
    const accountId = parseInt(req.query.accountId, 10)

    const tags = await peertubeHelpers.automaticTags.getAccountCommentAutomaticTags({ commentId, accountId })

    return res.json({
      tags: tags.map(t => t.name)
    })
  })

  router.get('/server-video-tags/:videoId', async (req, res) => {
    const videoId = parseInt(req.params.videoId, 10)

    const tags = await peertubeHelpers.automaticTags.getServerVideoAutomaticTags({ videoId })

    return res.json({
      tags: tags.map(t => t.name)
    })
  })
}

async function unregister() {
  return
}

module.exports = {
  register,
  unregister
}
