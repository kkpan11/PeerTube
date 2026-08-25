import { Routes } from '@angular/router'
import { AboutFollowsComponent } from '@app/+about/about-follows/about-follows.component'
import { AboutPeertubeComponent } from '@app/+about/about-peertube/about-peertube.component'
import { CustomMarkupService } from '@app/shared/shared-custom-markup/custom-markup.service'
import { DynamicElementService } from '@app/shared/shared-custom-markup/dynamic-element.service'
import { InstanceFollowService } from '@app/shared/shared-instance/instance-follow.service'
import { aboutInstanceRoutes } from './about-instance/about-instance.routes'
import { AboutComponent } from './about.component'

export default [
  {
    path: '',
    component: AboutComponent,
    providers: [
      InstanceFollowService,
      CustomMarkupService,
      DynamicElementService
    ],
    children: [
      {
        path: '',
        redirectTo: 'instance',
        pathMatch: 'full'
      },

      ...aboutInstanceRoutes,

      {
        path: 'peertube',
        component: AboutPeertubeComponent,
        data: {
          meta: {
            title: $localize`About PeerTube`
          }
        }
      },

      {
        path: 'follows',
        component: AboutFollowsComponent,
        data: {
          meta: {
            title: $localize`About this platform's network`
          }
        }
      },

      {
        path: 'contact',
        redirectTo: 'instance/contact',
        pathMatch: 'full'
      }
    ]
  }
] satisfies Routes
