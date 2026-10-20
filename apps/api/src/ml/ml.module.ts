import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ModelInferenceService } from './model-inference.service.js';
import { ModelMonitoringService } from './model-monitoring.service.js';
import { ModelRegistryController } from './model-registry.controller.js';
import { ModelRegistryService } from './model-registry.service.js';

/**
 * Model registry, lifecycle, registry-backed inference and monitoring
 * (Prompt 28). See docs/MODEL_REGISTRY.md.
 */
@Module({
  imports: [AiModule],
  controllers: [ModelRegistryController],
  providers: [ModelRegistryService, ModelInferenceService, ModelMonitoringService],
  exports: [ModelInferenceService],
})
export class MlModule {}
