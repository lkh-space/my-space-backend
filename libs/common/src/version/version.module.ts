import { DynamicModule, Module } from '@nestjs/common';
import { VersionController } from './version.controller.js';
import { VersionService } from './version.service.js';
import {
  VERSION_MODULE_OPTIONS,
  type VersionModuleOptions,
} from './version.constants.js';

@Module({
  controllers: [VersionController],
  providers: [
    {
      provide: VERSION_MODULE_OPTIONS,
      useValue: {},
    },
    VersionService,
  ],
  exports: [VersionService],
})
export class VersionModule {
  static register(options: VersionModuleOptions = {}): DynamicModule {
    return {
      module: VersionModule,
      controllers: [VersionController],
      providers: [
        {
          provide: VERSION_MODULE_OPTIONS,
          useValue: options,
        },
        VersionService,
      ],
      exports: [VersionService],
    };
  }
}
