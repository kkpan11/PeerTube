import { MComment } from '../models/video/video-comment.js'
import { MVideo } from '../models/video/video.js'

// Auto taggers are executed by the `build-object-automatic-tags` job, outside of any transaction: they are allowed to
// take a long time to return their result, for example to analyze the video files or to call an external service
// The handler can only assign tags it declared in `autoTagNames`, other returned tags are ignored

export type RegisterCommentAutoTaggerOptions = {
  autoTagNames: string[]

  handler: (options: { comment: Pick<MComment, 'text'> }) => Promise<{ tags: string[] }>
}

export type RegisterVideoAutoTaggerOptions = {
  autoTagNames: string[]

  // Only the video id/name/description are provided: use `peertubeHelpers.videos.getFiles(video.id)` and
  // `peertubeHelpers.videos.ffprobe(path)` to load and analyze its files if needed
  // A live video has no file yet when its auto taggers run
  handler: (options: { video: Pick<MVideo, 'id' | 'name' | 'description'> }) => Promise<{ tags: string[] }>
}
