import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BrowserFetchExecutor } from '@core/services/browser-fetch-executor.service';
import { RequestExecutionService } from '@core/services/request-execution.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: RequestExecutionService, useClass: BrowserFetchExecutor },
  ],
};
