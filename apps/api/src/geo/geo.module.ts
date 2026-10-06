import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { GeoController } from './geo.controller.js';
import {
  DisabledGeocodingProvider,
  GeocodingProvider,
  NominatimGeocodingProvider,
} from './geocoding.provider.js';
import { GeocodingService } from './geocoding.service.js';

/**
 * Geocoding behind the API.
 *
 * The provider is chosen once, from config, and injected as the abstract
 * `GeocodingProvider` — so tests replace it with a fake, and a production
 * deployment replaces it with a commercial geocoder, the same way.
 */
@Module({
  controllers: [GeoController],
  providers: [
    {
      provide: GeocodingProvider,
      inject: [AppConfig],
      useFactory: (config: AppConfig): GeocodingProvider => {
        const settings = config.geocoding;
        return settings.provider === 'nominatim'
          ? new NominatimGeocodingProvider(settings)
          : new DisabledGeocodingProvider();
      },
    },
    GeocodingService,
  ],
  exports: [GeocodingService],
})
export class GeoModule {}
