import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'oauth/callback',
    loadComponent: () => import('@features/oauth-callback/oauth-callback.component').then((m) => m.OAuthCallbackComponent),
  },
  {
    path: '',
    loadComponent: () => import('@features/workspace/workspace.component').then((m) => m.WorkspaceComponent),
  },
];
