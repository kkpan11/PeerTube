import { Pipe, PipeTransform, inject } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { HtmlRendererService } from '@app/core'

@Pipe({
  name: 'nl2br',
  standalone: true
})
export class Nl2BrPipe implements PipeTransform {
  private htmlRenderer = inject(HtmlRendererService)
  private domSanitizer = inject(DomSanitizer)

  transform (value: string, allowFormatting = false): SafeHtml {
    // Already sanitized by HtmlRendererService
    return this.domSanitizer.bypassSecurityTrustHtml(this.htmlRenderer.convertToBr(value, allowFormatting))
  }
}
